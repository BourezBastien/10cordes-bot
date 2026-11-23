import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { AppEnv } from '../../app.env';
import { PrismaService } from '../database/prisma.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { ImagelabService } from '../imagelab/imagelab.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { AgentSettingsService } from '../guild-config/agent-settings.service';
import { IntegrationService } from '../integrations/integration.service';
import { safeFetch, assertSafeUrl } from '../../shared/utils/safe-fetch';
import { setLlmAccessor } from './llm.accessor';
import { LlmFormatLeakError, ProviderHttpError, throwProviderError } from './llm.errors';
import { parseChatCompletion } from './llm-response';
import { buildChatRequestBody, encodeApiTools } from './llm-request';
import { readChatStream } from './llm-stream.reader';
import { ReasoningEffortPlanner } from './llm-thinking.planner';
import { buildLlmTools } from './llm.tools';
import type { ChatCompletionResult, ChatMessage, ChatOptions, LlmStatus, OpenAiTool } from './llm.types';
import { maskKey, normalizeBaseUrl } from './llm.utils';
import { fileLog } from '../logging/file-log.service';

// Contrats et erreurs historiquement exportés depuis ce fichier.
export * from './llm.errors';
export * from './llm.types';
export { fromApiToolName, normalizeBaseUrl, toApiToolName } from './llm.utils';

const log = new Logger('Llm');

/** Configuration runtime du LLM (modale owner), prioritaire sur l'env. */
interface LlmRuntimeConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Streaming : watchdog d'inactivité (30 s sans delta) et durée totale max. */
const STREAM_INACTIVITY_MS = 30_000;
const STREAM_HARD_CAP_MS = 180_000;

/** Appel bloquant : délai au-delà duquel la demande échoue avec une erreur visible. */
const CHAT_TIMEOUT_MS = 60_000;

const NOT_CONFIGURED_MESSAGE = 'Le module IA n\u0027est pas configuré (aucune clé API).';

/**
 * Client LLM compatible OpenAI (chat completions + tool calling).
 * Config : modale owner (table IntegrationConfig, effet immédiat) sinon env.
 * Détient les secrets (clé runtime) : le corps des requêtes, le parsing des
 * réponses, le filtre du stream, la décision d'effort et les tools vivent
 * dans des modules sans secret.
 */
@Injectable()
export class LlmService implements SpraxiumOnBoot {
  private runtime: LlmRuntimeConfig | null = null;
  /** L'endpoint a refusé le champ `reasoning_effort` en 400 : il n'est plus envoyé. */
  private effortFieldRejected = false;
  private readonly effortPlanner: ReasoningEffortPlanner;

  constructor(
    private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
    private readonly imagelab: ImagelabService,
    private readonly config: GuildConfigService,
    private readonly integrations: IntegrationService,
    agentSettings: AgentSettingsService,
  ) {
    this.effortPlanner = new ReasoningEffortPlanner({ env, agentSettings, baseUrl: () => this.baseUrl });
  }

  async onBoot(): Promise<void> {
    setLlmAccessor(this);
    try {
      const row = await this.prisma.integrationConfig.findUnique({ where: { id: 'llm' } });
      if (row) {
        this.runtime = { provider: row.provider, baseUrl: row.baseUrl, apiKey: row.apiKey, model: row.model };
      }
    } catch {
      // Table pas encore migrée au tout premier boot : l'env prend le relais.
    }
    for (const tool of buildLlmTools({ llm: this, config: this.config, imagelab: this.imagelab })) {
      this.registry.register(tool);
    }
  }

  get configured(): boolean {
    return Boolean(this.runtime?.apiKey || this.env.LLM_API_KEY);
  }

  get model(): string {
    return this.runtime?.model || this.env.LLM_MODEL || '';
  }

  /** Runtime (modal) PRIME ; sinon bootstrap env. La clé ET l'URL retombent
   * ensemble sur l'env (le bug « Invalid URL: null » venait du fallback oublié). */
  private get baseUrl(): string | null {
    return this.runtime?.baseUrl ?? this.env.LLM_API_URL ?? null;
  }

  private get apiKey(): string | undefined {
    return this.runtime?.apiKey ?? this.env.LLM_API_KEY;
  }

  /** Statut masqué (clé tronquée) pour les tools et le panneau de configuration. */
  status(): LlmStatus {
    if (this.runtime) {
      return {
        source: 'modal',
        provider: this.runtime.provider,
        baseUrl: this.runtime.baseUrl,
        model: this.runtime.model,
        maskedKey: maskKey(this.runtime.apiKey),
      };
    }
    if (this.env.LLM_API_KEY && this.env.LLM_API_URL) {
      return {
        source: 'env',
        provider: 'env',
        baseUrl: this.env.LLM_API_URL ?? null,
        model: this.env.LLM_MODEL ?? null,
        maskedKey: maskKey(this.env.LLM_API_KEY),
      };
    }
    return { source: 'none', provider: null, baseUrl: null, model: null, maskedKey: null };
  }

  /** Teste la connexion (GET /models) puis persiste : effet immédiat, sans restart. */
  async applyConfig(provider: string, baseUrl: string, apiKey: string, model: string): Promise<void> {
    const cleanBase = normalizeBaseUrl(baseUrl);
    const response = await safeFetch(`${cleanBase}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Connexion échouée (${response.status}) : ${detail.slice(0, 160) || 'vérifie la clé et la base URL'}`);
    }
    this.runtime = { provider, baseUrl: cleanBase, apiKey, model: model.trim() };
    await this.integrations.upsert('llm', { baseUrl: cleanBase, apiKey, model: model.trim() }, 'modal').catch(() => {});
  }

  /**
   * Décide UNE fois, avant le premier tour d'une boucle, l'effort de
   * raisonnement de toute la requête. À passer tel quel dans chaque appel
   * (`ChatOptions.reasoningEffort`) : il ne change plus en cours de boucle.
   */
  planReasoningEffort(options: Pick<ChatOptions, 'userId' | 'guildId' | 'cause'>, actionIntent: boolean): Promise<string | null> {
    return this.effortPlanner.plan(options, actionIntent);
  }

  /**
   * Appel chat avec garde-fou : Promise.race + setTimeout. L'AbortSignal seul
   * ne se déclenche pas de façon fiable sur tous les runtimes : sans cette
   * course, un appel qui ne répond jamais fait taire l'agent indéfiniment.
   */
  async chat(messages: ChatMessage[], tools: OpenAiTool[], options: ChatOptions): Promise<ChatCompletionResult> {
    if (!this.configured) {
      throw new Error(NOT_CONFIGURED_MESSAGE);
    }
    return Promise.race([this.withEffortCompat(options, () => this.doChat(messages, tools, options)), this.timeoutGuard()]);
  }

  /**
   * Chat en STREAMING SSE (Phase 2.2) : les deltas de texte sont poussés au
   * callback au fil de l'eau ; le résultat COMPLET est retourné à la fin.
   * Watchdog : AbortController RÉEL qui annule le fetch après 30 s sans
   * delta (réarmé à chaque événement) et 180 s de durée totale.
   */
  async chatStream(
    messages: ChatMessage[],
    tools: OpenAiTool[],
    options: ChatOptions,
    callbacks: { onDelta?: (text: string) => void; toolChoice?: 'auto' | 'none' } = {},
  ): Promise<ChatCompletionResult> {
    const mergedOptions: ChatOptions = { ...options, ...(callbacks.toolChoice ? { toolChoice: callbacks.toolChoice } : {}) };
    if (!this.configured) {
      throw new Error(NOT_CONFIGURED_MESSAGE);
    }

    const controller = new AbortController();
    let inactivityTimer: NodeJS.Timeout | null = null;
    const armInactivityWatchdog = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => controller.abort(), STREAM_INACTIVITY_MS);
      inactivityTimer.unref?.();
    };
    const hardCap = setTimeout(() => controller.abort(), STREAM_HARD_CAP_MS);
    hardCap.unref?.();

    try {
      armInactivityWatchdog();
      // Le corps est construit dans la tentative : un endpoint qui refuse
      // `reasoning_effort` (400) fait rejouer l'appel une fois, sans le champ.
      return await this.withEffortCompat(mergedOptions, async () => {
        const response = await fetch(assertSafeUrl(`${this.baseUrl}/chat/completions`), {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(await this.requestBody(messages, tools, mergedOptions, true)),
        });
        if (!response.ok) {
          throwProviderError(response.status, await response.text().catch(() => ''));
        }
        if (!response.body) throw new Error('Streaming non supporté par le fournisseur (body absent).');
        return readChatStream(response.body, { onDelta: callbacks.onDelta, onActivity: armInactivityWatchdog });
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Le modèle IA a cessé d\u2019émettre (30 s sans donnée) : connexion annulée.');
      }
      this.traceFormatLeak(options.cause, error);
      throw error;
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      clearTimeout(hardCap);
    }
  }

  /** Effort d'un appel : la valeur décidée pour la requête, sinon la décision d'un appel isolé (sans tools). */
  private async requestBody(messages: ChatMessage[], tools: OpenAiTool[], options: ChatOptions, stream = false): Promise<Record<string, unknown>> {
    const apiTools = encodeApiTools(tools);
    const reasoningEffort = this.effortFieldRejected ? null : options.reasoningEffort !== undefined ? options.reasoningEffort : await this.effortPlanner.plan(options, false);
    return buildChatRequestBody({ model: this.model, messages, apiTools, options, reasoningEffort, stream });
  }

  /** Rejoue une fois l'appel quand l'endpoint refuse le champ `reasoning_effort` (400 explicite). */
  private async withEffortCompat<T>(options: ChatOptions, attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (error) {
      if (this.effortFieldRejected || !(error instanceof ProviderHttpError) || error.status !== 400 || !/reasoning_effort/iu.test(error.detail)) {
        throw error;
      }
      this.effortFieldRejected = true;
      log.warn('l\u0027endpoint refuse le champ reasoning_effort (400) : il est omis désormais');
      return attempt();
    }
  }

  /** Traçabilité d'une fuite de balises internes (diagnose.mjs consomme ces lignes). */
  private traceFormatLeak(cause: ChatOptions['cause'], error: unknown): void {
    if (error instanceof LlmFormatLeakError) {
      fileLog()?.event('warn', 'llm', 'format_leak', { cause, sample: error.sample });
    }
  }

  private timeoutGuard(): Promise<never> {
    return new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Le modèle IA n\u0027a pas répondu dans les 60 secondes.')), CHAT_TIMEOUT_MS);
      timer.unref?.();
    });
  }

  private async doChat(
    messages: ChatMessage[],
    tools: OpenAiTool[],
    options: ChatOptions,
  ): Promise<ChatCompletionResult> {
    const response = await safeFetch(`${this.baseUrl}/chat/completions`, {
      // Effort low : réponse en quelques secondes ; 60s max sinon erreur visible.
      timeoutMs: CHAT_TIMEOUT_MS,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(await this.requestBody(messages, tools, options)),
    });
    if (!response.ok) {
      throwProviderError(response.status, await response.text().catch(() => ''));
    }
    return parseChatCompletion(await response.json(), (leak) => this.traceFormatLeak(options.cause, leak));
  }
}
