import type { ChatCompletionResult } from './chat-contract';
import { LlmFormatLeakError } from './format-leak.error';
import { containsInternalTokens, stripSpecialTokens } from './internal-tokens';
import { fromApiToolName } from './chat-utils';

/** Réponse bloquante `/chat/completions`, telle que l'API la livre. */
interface ChatCompletionResponse {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
}

/**
 * Met en forme la réponse d'un appel bloquant. Les balises internes du modèle
 * dans le texte sont une fuite : sans tool_call structuré le tour est refusé
 * (LlmFormatLeakError), avec un vrai tool_call seul le texte est nettoyé.
 */
export function parseChatCompletion(payload: unknown, onLeak: (error: LlmFormatLeakError) => void): ChatCompletionResult {
  const data = (payload ?? {}) as ChatCompletionResponse;
  const message = data.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: fromApiToolName(call.function.name),
    arguments: call.function.arguments,
  }));
  let content = message?.content ?? null;
  if (content && containsInternalTokens(content)) {
    const leak = new LlmFormatLeakError(content.slice(0, 80));
    if (toolCalls.length === 0) {
      onLeak(leak);
      throw leak;
    }
    content = stripSpecialTokens(content) || null;
  }
  return {
    content,
    reasoningContent: message?.reasoning_content ?? null,
    toolCalls,
    usage: data.usage
      ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 }
      : undefined,
  };
}
