import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { AppEnv } from '../../app.env';
import { safeFetch } from '../../shared/utils/safe-fetch';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { ImagelabService } from '../imagelab/imagelab.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { AgentSettingsService } from '../guild-config/agent-settings.service';
import { IntegrationService } from '../integrations/integration.service';
import { CapabilityRouterService } from '../providers/capability-router.service';
import { ProviderError } from '../providers/provider.types';
import { setLlmAccessor } from './llm.accessor';
import { isFallbackWorthy, LlmFormatLeakError } from './llm.errors';
import { ChatEndpointPlanner } from './llm-endpoint';
import { buildLlmTools } from './llm.tools';
import { ChatTransport, type ChatTurn, type ChatTurnCallbacks } from './llm-transport';
import { ReasoningEffortPlanner } from './llm-thinking.planner';
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

/** Streaming : durée totale max. Le délai sans paquet est gardé par ChatTransport. */
const STREAM_HARD_CAP_MS = 180_000;

/** Appel bloquant : délai au-delà duquel la demande échoue avec une erreur visible. */
const CHAT_TIMEOUT_MS = 60_000;

const STREAM_TOO_LONG_MESSAGE = 'Le modèle IA n\u0027a pas terminé sa réponse dans le délai maximal (3 min).';

/** Ce qu'une boucle garde identique sur tous les tours d'une requête. */
export interface LlmRequestPlan {
  reasoningEffort: string | null;
  preferReasoning: boolean;
}

/**
 * Client LLM (chat + tool calling), orchestrateur du moteur multi-fournisseurs.
 * Chaque tour est envoyé au modèle que son serveur a associé à la capacité
 * (route `chat.reasoning` ou `chat.default`), avec repli automatique sur le
 * fournisseur de secours ; sans route, à la configuration d'instance (modale
 * owner ou env). Où envoyer : ChatEndpointPlanner ; comment : ChatTransport.
 * Détient les secrets d'instance : la décision d'effort et les tools vivent
 * dans des modules sans secret.
 */
@Injectable()
export class LlmService implements SpraxiumOnBoot {
  private runtime: LlmRuntimeConfig | null = null;
  private readonly effortPlanner: ReasoningEffortPlanner;
  private readonly endpoints: ChatEndpointPlanner;
  private readonly transport: ChatTransport;

  constructor(
    private readonly env: AppEnv,
    private readonly registry: ToolRegistryService,
    private readonly imagelab: ImagelabService,
    private readonly config: GuildConfigService,
    private readonly integrations: IntegrationService,
    private readonly router: CapabilityRouterService,
    agentSettings: AgentSettingsService,
  ) {
    this.effortPlanner = new ReasoningEffortPlanner({ env, agentSettings, baseUrl: () => this.baseUrl });
    this.endpoints = new ChatEndpointPlanner({ router, legacy: () => ({ baseUrl: this.baseUrl, apiKey: this.apiKey, model: this.model }) });
    this.transport = new ChatTransport({ effortPlanner: this.effortPlanner, onLeak: (cause, error) => this.traceFormatLeak(cause, error) });
  }

  async onBoot(): Promise<void> {
    setLlmAccessor(this);
    // La ligne d'instance est chiffrée en base : IntegrationService est le seul à déchiffrer.
    const instance = await this.integrations.get('llm').catch(() => null);
    if (instance?.source === 'db') {
      this.runtime = { provider: 'custom', baseUrl: instance.config.baseUrl ?? '', apiKey: instance.config.apiKey ?? '', model: instance.config.model ?? '' };
    }
    // Les serveurs qui utilisent une copie de la configuration d'instance
    // (clé d'env tournée, modèle changé) sont alignés ici, une fois au boot.
    const synced = await this.router.reconcileInstance().catch(() => null);
    if (synced && synced.updated > 0) log.info(`Copies de la configuration d'instance alignées : ${synced.updated} serveur(s).`);
    for (const tool of buildLlmTools({ llm: this, config: this.config, imagelab: this.imagelab })) {
      this.registry.register(tool);
    }
  }

  get configured(): boolean {
    return Boolean(this.runtime?.apiKey || this.env.LLM_API_KEY);
  }

  /** Ce serveur peut-il converser : une route de conversation, sinon la configuration d'instance. */
  async isConfiguredFor(guildId: string | null): Promise<boolean> {
    if (this.configured) return true;
    return guildId !== null && (await this.router.chatEndpoint(guildId, 'reply', false).catch(() => null)) !== null;
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

  /** Statut masqué (clé tronquée) de l'instance, pour les tools et le panneau de configuration. */
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
    // Les serveurs qui utilisent une copie de cette configuration suivent le changement.
    await this.router.reconcileInstance().catch(() => null);
  }

  /**
   * Décide UNE fois, avant le premier tour d'une boucle, ce que toute la
   * requête garde identique : l'effort de raisonnement et la capacité de
   * conversation (`ChatOptions.reasoningEffort` et `preferReasoning`). Le
   * modèle d'une requête ne change pas en cours de boucle.
   */
  async planRequest(options: Pick<ChatOptions, 'userId' | 'guildId' | 'cause'>, actionIntent: boolean): Promise<LlmRequestPlan> {
    const preferReasoning = await this.effortPlanner.wants(options, actionIntent);
    const route = await this.router.chatEndpoint(options.guildId, options.cause, preferReasoning).catch(() => null);
    return { preferReasoning, reasoningEffort: await this.effortPlanner.plan(options, actionIntent, route?.provider.baseUrl) };
  }

  /** Effort de raisonnement de la requête (à passer tel quel dans chaque appel). */
  planReasoningEffort(options: Pick<ChatOptions, 'userId' | 'guildId' | 'cause'>, actionIntent: boolean): Promise<string | null> {
    return this.planRequest(options, actionIntent).then((plan) => plan.reasoningEffort);
  }

  /** Capacité de conversation du tour : celle décidée pour la requête, sinon déduite de son effort. */
  private preferReasoning(options: ChatOptions): Promise<boolean> {
    if (options.preferReasoning !== undefined) return Promise.resolve(options.preferReasoning);
    const effort = options.reasoningEffort;
    if (effort === 'none') return Promise.resolve(false);
    if (effort) return Promise.resolve(true);
    return this.effortPlanner.wants(options, false);
  }

  /**
   * Appel chat avec garde-fou : Promise.race + setTimeout. L'AbortSignal seul
   * ne se déclenche pas de façon fiable sur tous les runtimes : sans cette
   * course, un appel qui ne répond jamais fait taire l'agent indéfiniment.
   */
  async chat(messages: ChatMessage[], tools: OpenAiTool[], options: ChatOptions): Promise<ChatCompletionResult> {
    const turn = { stream: false, timeoutMs: CHAT_TIMEOUT_MS };
    return Promise.race([this.runTurn(messages, tools, options, {}, turn, () => false), this.timeoutGuard()]);
  }

  /**
   * Chat en STREAMING : les deltas de texte sont poussés au callback au fil
   * de l'eau ; le résultat COMPLET est retourné à la fin. Garde-fous : le
   * flux est coupé après 30 s sans donnée (ChatTransport) et 180 s au total.
   */
  async chatStream(
    messages: ChatMessage[],
    tools: OpenAiTool[],
    options: ChatOptions,
    callbacks: { onDelta?: (text: string) => void; toolChoice?: 'auto' | 'none' } = {},
  ): Promise<ChatCompletionResult> {
    const mergedOptions: ChatOptions = { ...options, ...(callbacks.toolChoice ? { toolChoice: callbacks.toolChoice } : {}) };
    const controller = new AbortController();
    const hardCap = setTimeout(() => controller.abort(), STREAM_HARD_CAP_MS);
    hardCap.unref?.();
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error(STREAM_TOO_LONG_MESSAGE)), { once: true });
    });
    let published = false;
    const emit: ChatTurnCallbacks = {
      onDelta: (text) => {
        published = true;
        callbacks.onDelta?.(text);
      },
    };
    const turn = { stream: true, timeoutMs: CHAT_TIMEOUT_MS, signal: controller.signal };
    try {
      return await Promise.race([this.runTurn(messages, tools, mergedOptions, emit, turn, () => published), aborted]);
    } catch (error) {
      this.traceFormatLeak(options.cause, error);
      throw error;
    } finally {
      clearTimeout(hardCap);
    }
  }

  /**
   * Un tour de conversation : le fournisseur principal de la route, puis son
   * repli si l'erreur y invite (429, 5xx, délai) et qu'aucun texte n'a été
   * publié. Sans route (configuration d'instance), une seule tentative.
   */
  private async runTurn(
    messages: ChatMessage[],
    tools: OpenAiTool[],
    options: ChatOptions,
    callbacks: ChatTurnCallbacks,
    turn: Omit<ChatTurn, 'messages' | 'tools' | 'options'>,
    published: () => boolean,
  ): Promise<ChatCompletionResult> {
    const planned = await this.endpoints.plan(options, await this.preferReasoning(options));
    if (!planned.route) {
      const result = await this.transport.send(planned, { ...turn, messages, tools, options }, callbacks);
      return { ...result, served: { provider: 'instance', model: planned.model, fallback: false, capability: options.cause } };
    }
    const attempts = this.router.attemptsOf(planned.route);
    if (attempts.length === 0) {
      throw new ProviderError(`${planned.route.provider.slug} (${planned.route.provider.protocol}) ne sert pas la conversation.`, 'unsupported');
    }
    for (const [index, attempt] of attempts.entries()) {
      const endpoint = this.endpoints.forProvider(attempt.provider, attempt.modelId, planned.route, attempt.adapter);
      const onBackup = index > 0;
      try {
        const result = await this.transport.send(endpoint, { ...turn, messages, tools, options }, callbacks);
        if (onBackup) this.router.noteFallback(planned.route, attempt.provider, options.userId);
        return { ...result, served: { provider: attempt.provider.slug, model: endpoint.model, fallback: onBackup, capability: planned.route?.capability } };
      } catch (error) {
        const last = index === attempts.length - 1;
        if (last || published() || !isFallbackWorthy(error)) throw error;
        log.warn(`fournisseur principal en échec pour « ${planned.route.capability} » (${attempt.provider.slug}) : bascule sur le repli`);
      }
    }
    throw new Error('Tour de conversation non exécuté.');
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
}
