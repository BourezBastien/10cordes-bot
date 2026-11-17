import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import type { BotTool } from '@10cordes/shared';
import { z } from 'zod';
import { safeFetch } from '../../shared/utils/safe-fetch';
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

/** Presets par fournisseur — la modale pré-remplit via le placeholder. */
export const LLM_PRESETS: Record<string, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: '' },
};

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
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
    return Boolean(this.runtime?.apiKey || this.env.DEEPSEEK_API_KEY);
  }

  get model(): string {
    return this.runtime?.model || this.env.DEEPSEEK_MODEL;
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
    if (this.env.DEEPSEEK_API_KEY) {
      return {
        source: 'env',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: this.env.DEEPSEEK_MODEL,
        maskedKey: maskKey(this.env.DEEPSEEK_API_KEY),
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
    const row = { provider, baseUrl: cleanBase, apiKey, model: model.trim() };
    await this.prisma.integrationConfig.upsert({
      where: { id: 'llm' },
      create: { id: 'llm', ...row },
      update: row,
    });
    this.runtime = row;
  }

  /** Rebranche sur l'env (supprime la config modale). */
  async clearConfig(): Promise<void> {
    await this.prisma.integrationConfig.deleteMany({ where: { id: 'llm' } });
    this.runtime = null;
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
    const baseUrl = this.runtime?.baseUrl ?? 'https://api.deepseek.com';
    const apiKey = this.runtime?.apiKey ?? this.env.DEEPSEEK_API_KEY;
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
        messages,
        user_id: options.guildId ?? options.userId,
        reasoning_effort: this.env.DEEPSEEK_EFFORT || 'low',
        ...(apiTools.length > 0 ? { tools: apiTools, tool_choice: 'auto' } : {}),
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
