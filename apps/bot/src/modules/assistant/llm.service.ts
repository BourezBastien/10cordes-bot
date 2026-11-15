import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { safeFetch } from '../../shared/utils/safe-fetch';
import { AppEnv } from '../../app.env';
import { PrismaService } from '../database/prisma.service';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
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

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ToolCallRequest[];
}

export interface ChatOptions {
  userId: string;
  guildId: string | null;
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
  ) {}

  async onBoot(): Promise<void> {
    try {
      const row = await this.prisma.integrationConfig.findUnique({ where: { id: 'llm' } });
      if (row) {
        this.runtime = { provider: row.provider, baseUrl: row.baseUrl, apiKey: row.apiKey, model: row.model };
      }
    } catch {
      // Table pas encore migrée au tout premier boot : l'env prend le relais.
    }
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

  async chat(messages: ChatMessage[], tools: OpenAiTool[], options: ChatOptions): Promise<ChatCompletionResult> {
    if (!this.configured) {
      throw new Error('Le module IA n\'est pas configuré (aucune clé API).');
    }

    const baseUrl = this.runtime?.baseUrl ?? 'https://api.deepseek.com';
    const apiKey = this.runtime?.apiKey ?? this.env.DEEPSEEK_API_KEY;
    const model = this.model;

    const apiTools = tools.map((tool) => ({
      ...tool,
      function: { ...tool.function, name: toApiToolName(tool.function.name) },
    }));

    const response = await safeFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        user_id: options.guildId ?? options.userId,
        ...(apiTools.length > 0 ? { tools: apiTools, tool_choice: 'auto' } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`LLM ${response.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
    };
    const message = data.choices?.[0]?.message;
    return {
      content: message?.content ?? null,
      toolCalls: (message?.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: fromApiToolName(call.function.name),
        arguments: call.function.arguments,
      })),
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
