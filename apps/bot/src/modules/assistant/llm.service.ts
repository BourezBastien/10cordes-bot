import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import type { BotTool } from '@10cordes/shared';
import { z } from 'zod';
import { safeFetch, assertSafeUrl } from '../../shared/utils/safe-fetch';
import { AppEnv } from '../../app.env';
import { PrismaService } from '../database/prisma.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { ImagelabService } from '../imagelab/imagelab.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { setLlmAccessor } from './llm.accessor';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  /** Requis sur le message assistant qui précède des messages tool (exigé par l'API). */
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  /** Modèle thinking : le reasoning_content doit être renvoyé tel quel à l'écho assistant. */
  reasoning_content?: string | null;
}

export interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatCompletionResult {
  content: string | null;
  reasoningContent: string | null;
  toolCalls: ToolCallRequest[];
  usage?: ChatUsage;
}

export type ChatCause = 'reply' | 'web' | 'consolidation' | 'triage';

export interface ChatOptions {
  /** 'none' = forcer un tour final de synthèse sans tool_calls (R0.2). */
  toolChoice?: 'auto' | 'none';
  userId: string;
  guildId: string | null;
  cause: ChatCause;
}

/** Crédits du fournisseur IA épuisés : l'appel est refusé côté API (402). */
export class QuotaExhaustedError extends Error {
  constructor() {
    super('Crédits IA épuisés : le fournisseur a refusé l\u0027appel (402).');
    this.name = 'QuotaExhaustedError';
  }
}

/** Streaming : watchdog d'inactivité (30 s sans delta) et durée totale max. */
const STREAM_INACTIVITY_MS = 30_000;
const STREAM_HARD_CAP_MS = 180_000;

/** Clé/API invalide ou révoquée : configuration à corriger (401/403). */
export class ProviderAuthError extends Error {
  constructor() {
    super('Configuration IA invalide : le fournisseur rejette l\u0027authentification (401).');
    this.name = 'ProviderAuthError';
  }
}

/** Fournisseur indisponible ou erreur serveur (5xx, réseau). */
export class ProviderUnavailableError extends Error {
  constructor() {
    super('Fournisseur IA indisponible (erreur serveur ou réseau).');
    this.name = 'ProviderUnavailableError';
  }
}

/** Configuration runtime du LLM (modale owner) — prioritaire sur l'env. */
interface LlmRuntimeConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface LlmStatus {
  source: 'modal' | 'env' | 'none';
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  maskedKey: string | null;
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Les contenus Discord (messages des membres, transcripts, résultats d'outils)
 * peuvent contenir des surrogate pairs isolés (emoji copiés-collés corrompus).
 * JSON.stringify les encode en \uD83X seuls : le fournisseur répond alors
 * 400 « unexpected end of hex escape » et la demande échoue. On les retire.
 */
function stripLoneSurrogates(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu, '');
}

/**
 * Client LLM compatible OpenAI (chat completions + tool calling).
 * Config : modale owner (table IntegrationConfig, effet immédiat) sinon env.
 * Les noms de tools namespacés sont encodés pour l'API (points interdits).
 */
@Injectable()
export class LlmService implements SpraxiumOnBoot {
  private runtime: LlmRuntimeConfig | null = null;

  constructor(
    private readonly env: AppEnv,
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
    private readonly imagelab: ImagelabService,
    private readonly config: GuildConfigService,
    private readonly integrations: import('../integrations/integration.service').IntegrationService,
  ) {}

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
    this.registry.register(this.statusTool());
    this.registry.register(this.dedicatedChannelTool());
    this.registry.register(this.translateTool());
  }

  /** Tool translate : réutilise le LLM configuré (aucune API externe en plus). */
  private translateTool(): BotTool {
    return {
      name: 'translate',
      description: 'Traduit un texte vers la langue cible (réutilise le modèle IA configuré).',
      category: 'assistant',
      paramsSchema: z.object({
        text: z.string().min(1).max(4000),
        target: z.string().min(2).max(30).default('français').describe('Langue cible (ex: français, english, español)'),
      }),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt:
        'Renvoie UNIQUEMENT la traduction, sans commentaire ni guillemets ajoutés. Préserve le ton, les noms propres et le markdown.',
      handler: async (input) => {
        if (!this.configured) return { ok: false, summary: 'Le module IA n\u0027est pas configuré.' };
        const { text, target } = input as { text: string; target?: string };
        const completion = await this.chat(
          [
            { role: 'system', content: `Traduis le texte suivant en ${target ?? 'français'}. Réponds UNIQUEMENT avec la traduction.` },
            { role: 'user', content: text },
          ],
          [],
          { userId: 'translate', guildId: null, cause: 'consolidation' },
        ).catch(() => null);
        if (!completion?.content) return { ok: false, summary: 'Traduction impossible (fournisseur IA injoignable).' };
        return { ok: true, summary: completion.content };
      },
    };
  }

  /** Tool setDedicatedChannel : désigne le salon où l'agent engage sans mention. */
  private dedicatedChannelTool(): BotTool {
    return {
      name: 'setDedicatedChannel',
      description: "Désigne le salon dédié de l'agent IA : tous les messages y sont traités sans mention. Salon actuel si channelId omis.",
      category: 'assistant',
      paramsSchema: z.object({ channelId: z.string().min(1).optional() }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: "Configure le salon dédié de l'agent quand l'utilisateur le demande, en résolvant le nom via getChannels.",
      handler: async (input, ctx) => {
        if (ctx.guildId === null) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { channelId } = input as { channelId?: string };
        const target = channelId ?? ctx.channelId;
        if (!target) return { ok: false, summary: 'Aucun salon identifiable.' };
        await this.config.patch(ctx.guildId, { assistant: { channelId: target } });
        return { ok: true, summary: `Salon dédié IA : <#${target}>. Tous les messages y sont traités sans mention.` };
      },
    };
  }

  /** Tool getAIStatus : l'agent vérifie lui-même l'état des connexions IA. */
  private statusTool(): BotTool {
    return {
      name: 'getAIStatus',
      description: 'Connexion IA de cette instance : fournisseur, modèle, clé (masquée), PixelLab.',
      category: 'assistant',
      paramsSchema: z.object({}).loose(),
      requiredModules: [],
      permissions: ['ManageGuild'],
      scope: 'user',
      destructive: false,
      systemPrompt:
        'Read-only. Contient des infos sensibles : la réponse est éphémère. Call FIRST when the user asks whether the IA/DeepSeek/provider is configured, connected or working.',
      handler: async () => {
        const status = this.status();
        const lines =
          status.source === 'none'
            ? ['IA non connectée : aucun fournisseur. L\'owner peut la connecter via la modale (bouton du panneau).']
            : [
                `IA connectée via ${status.source === 'modal' ? 'la modale' : "l'environnement"} : ${status.provider} / \`${status.model}\` (clé ${status.maskedKey}).`,
              ];
        lines.push(this.imagelab.configured ? 'PixelLab connecté.' : 'PixelLab non configuré.');
        return { ok: true, summary: lines.join(' '), data: { ...status, pixellab: this.imagelab.configured } };
      },
    };
  }

  get configured(): boolean {
    return Boolean(this.runtime?.apiKey || this.env.LLM_API_KEY);
  }

  get model(): string {
    return this.runtime?.model || this.env.LLM_MODEL || '';
  }

  /** Statut masqué (clé tronquée) pour /setup agent status et les tools. */
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
        maskedKey: this.env.LLM_API_KEY ? maskKey(this.env.LLM_API_KEY) : null,
      };
    }
    return { source: 'none', provider: null, baseUrl: null, model: null, maskedKey: null };
  }

  /** Teste la connexion (GET /models) puis persiste — effet immédiat, sans restart. */
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
   * Appel chat avec garde-fou : Promise.race + setTimeout. L'AbortSignal seul
   * ne se déclenche pas de façon fiable sur tous les runtimes : sans cette
   * course, un appel qui ne répond jamais fait taire l'agent indéfiniment.
   */
  async chat(messages: ChatMessage[], tools: OpenAiTool[], options: ChatOptions): Promise<ChatCompletionResult> {
    if (!this.configured) {
      throw new Error('Le module IA n\'est pas configuré (aucune clé API).');
    }
    return Promise.race([this.doChat(messages, tools, options), this.timeoutGuard()]);
  }

  /**
   * Chat en STREAMING SSE (Phase 2.2) : les deltas de texte sont poussés au
   * callback au fil de l'eau ; le résultat COMPLET (contenu + tool_calls
   * réassemblés par index + usage) est retourné à la fin.
   * Watchdog : AbortController RÉEL qui annule le fetch après 30 s sans
   * delta (réarmé à chaque événement) et 180 s de durée totale — le fetch
   * résiduel ne consomme plus rien.
   */
  async chatStream(
    messages: ChatMessage[],
    tools: OpenAiTool[],
    options: ChatOptions,
    callbacks: { onDelta?: (text: string) => void; toolChoice?: 'auto' | 'none' } = {},
  ): Promise<ChatCompletionResult> {
    const mergedOptions: ChatOptions = { ...options, ...(callbacks.toolChoice ? { toolChoice: callbacks.toolChoice } : {}) };
    if (!this.configured) {
      throw new Error('Le module IA n\'est pas configuré (aucune clé API).');
    }
    const baseUrl = this.runtime?.baseUrl ?? null;
    const apiKey = this.runtime?.apiKey ?? this.env.LLM_API_KEY;
    const apiTools = tools.map((tool) => ({
      ...tool,
      function: { ...tool.function, name: toApiToolName(tool.function.name) },
    }));

    const controller = new AbortController();
    let inactivityTimer: NodeJS.Timeout | null = null;
    const armInactivityWatchdog = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => controller.abort(), STREAM_INACTIVITY_MS);
      inactivityTimer.unref?.();
    };
    const hardCap = setTimeout(() => controller.abort(), STREAM_HARD_CAP_MS);
    hardCap.unref?.();

    let response: Response;
    try {
      armInactivityWatchdog();
      response = await fetch(assertSafeUrl(`${baseUrl}/chat/completions`), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: this.model,
          stream: true,
          stream_options: { include_usage: true },
          messages: messages.map((message) => ({
            ...message,
            content: typeof message.content === 'string' ? stripLoneSurrogates(message.content) : message.content,
          })),
          user_id: options.guildId ?? options.userId,
          reasoning_effort: this.env.LLM_EFFORT,
          ...(apiTools.length > 0 ? { tools: apiTools, tool_choice: mergedOptions.toolChoice ?? 'auto' } : {}),
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        if (response.status === 402 || detail.includes('insufficient_balance')) throw new QuotaExhaustedError();
        if (response.status === 401 || response.status === 403) throw new ProviderAuthError();
        if (response.status >= 500) throw new ProviderUnavailableError();
        throw new Error(`LLM ${response.status}: ${detail.slice(0, 200)}`);
      }
      if (!response.body) throw new Error('Streaming non supporté par le fournisseur (body absent).');

      // Accumulation : contenu + tool_calls FRAGMENTÉS par index.
      let content = '';
      let reasoning = '';
      const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();
      let usage: { promptTokens: number; completionTokens: number } | undefined;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armInactivityWatchdog();
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const chunk = JSON.parse(payload) as {
              choices?: Array<{
                delta?: {
                  content?: string | null;
                  reasoning_content?: string | null;
                  tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
                };
              }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            if (chunk.usage) {
              usage = { promptTokens: chunk.usage.prompt_tokens ?? 0, completionTokens: chunk.usage.completion_tokens ?? 0 };
            }
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;
            if (delta.content) {
              content += delta.content;
              callbacks.onDelta?.(delta.content);
            }
            if (delta.reasoning_content) reasoning += delta.reasoning_content;
            for (const call of delta.tool_calls ?? []) {
              const index = call.index ?? 0;
              const acc = toolAcc.get(index) ?? { id: '', name: '', arguments: '' };
              if (call.id) acc.id = call.id;
              if (call.function?.name) acc.name += call.function.name;
              if (call.function?.arguments) acc.arguments += call.function.arguments;
              toolAcc.set(index, acc);
            }
          } catch {
            /* chunk non-JSON : ignoré */
          }
        }
      }
      return {
        content: content || null,
        reasoningContent: reasoning || null,
        toolCalls: [...toolAcc.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, acc]) => ({ id: acc.id, name: fromApiToolName(acc.name), arguments: acc.arguments })),
        usage,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Le modèle IA a cessé d\u2019émettre (30 s sans donnée) : connexion annulée.');
      }
      throw error;
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      clearTimeout(hardCap);
    }
  }

  private timeoutGuard(): Promise<never> {
    return new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Le modèle IA n\'a pas répondu dans les 60 secondes.')),
        60_000,
      );
      timer.unref?.();
    });
  }

  private async doChat(
    messages: ChatMessage[],
    tools: OpenAiTool[],
    options: ChatOptions,
  ): Promise<ChatCompletionResult> {
    const baseUrl = this.runtime?.baseUrl ?? null;
    const apiKey = this.runtime?.apiKey ?? this.env.LLM_API_KEY;
    const model = this.model;

    const apiTools = tools.map((tool) => ({
      ...tool,
      function: { ...tool.function, name: toApiToolName(tool.function.name) },
    }));

    const response = await safeFetch(`${baseUrl}/chat/completions`, {
      // Effort low : réponse en quelques secondes ; 60s max sinon erreur visible.
      timeoutMs: 60_000,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: messages.map((message) => ({
          ...message,
          content: typeof message.content === 'string' ? stripLoneSurrogates(message.content) : message.content,
        })),
        user_id: options.guildId ?? options.userId,
        reasoning_effort: this.env.LLM_EFFORT,
        ...(apiTools.length > 0 ? { tools: apiTools, tool_choice: options.toolChoice ?? 'auto' } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 402 || detail.includes('insufficient_balance')) {
        throw new QuotaExhaustedError();
      }
      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthError();
      }
      if (response.status >= 500) {
        throw new ProviderUnavailableError();
      }
      throw new Error(`LLM ${response.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
    };
    const message = data.choices?.[0]?.message;
    return {
      content: message?.content ?? null,
      reasoningContent: message?.reasoning_content ?? null,
      toolCalls: (message?.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: fromApiToolName(call.function.name),
        arguments: call.function.arguments,
      })),
      usage: data.usage
        ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 }
        : undefined,
    };
  }
}

export function toApiToolName(name: string): string {
  return name.replaceAll('.', '__');
}

export function fromApiToolName(apiName: string): string {
  return apiName.replaceAll('__', '.');
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}
