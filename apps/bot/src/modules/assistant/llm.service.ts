import { Injectable } from '@spraxium/common';
import { safeFetch } from '../../shared/utils/safe-fetch';
import type { AppEnv } from '../../app.env';

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

const API_URL = "https://api.deepseek.com/chat/completions";

/** Client DeepSeek (compatible OpenAI chat completions + tool calling). */
@Injectable()
export class LlmService {
  constructor(private readonly env: AppEnv) {}

  get configured(): boolean {
    return Boolean(this.env.DEEPSEEK_API_KEY);
  }

  get model(): string {
    return this.env.DEEPSEEK_MODEL;
  }

  async chat(messages: ChatMessage[], tools: OpenAiTool[], options: ChatOptions): Promise<ChatCompletionResult> {
    if (!this.configured) {
      throw new Error("DEEPSEEK_API_KEY is not configured on this instance.");
    }

    const response = await safeFetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: this.env.DEEPSEEK_MODEL,
        messages,
        user_id: options.guildId ?? options.userId,
        ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`DeepSeek ${response.status}: ${detail.slice(0, 200)}`);
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
        name: call.function.name,
        arguments: call.function.arguments,
      })),
    };
  }
}
