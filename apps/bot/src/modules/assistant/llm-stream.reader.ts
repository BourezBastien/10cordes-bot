import type { ChatCompletionResult, ChatUsage, ToolCallRequest } from './llm.types';
import { LlmFormatLeakError } from './llm.errors';
import { LlmStreamSanitizer } from './llm-stream.sanitizer';
import { fromApiToolName } from './llm.utils';

/** Fragment tel que l'API le livre dans un delta (champs tous optionnels). */
interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Accumule les deltas d'un stream SSE de chat : contenu, raisonnement,
 * tool_calls FRAGMENTÉS par index (id, nom et arguments arrivent en morceaux)
 * et usage. Pur : les erreurs d'un fragment non JSON sont ignorées.
 */
export class ChatStreamAccumulator {
  private content = '';
  private reasoning = '';
  private readonly toolCalls = new Map<number, ToolCallRequest>();
  private usage: ChatUsage | undefined;

  /** Applique le payload d'une ligne `data:` (le marqueur est déjà retiré). */
  push(payload: string, onDelta?: (text: string) => void): void {
    if (payload === '[DONE]') return;
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(payload) as StreamChunk;
    } catch {
      return; // chunk non-JSON : ignoré
    }
    if (chunk.usage) {
      this.usage = { promptTokens: chunk.usage.prompt_tokens ?? 0, completionTokens: chunk.usage.completion_tokens ?? 0 };
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      this.content += delta.content;
      onDelta?.(delta.content);
    }
    if (delta.reasoning_content) this.reasoning += delta.reasoning_content;
    for (const call of delta.tool_calls ?? []) {
      const index = call.index ?? 0;
      const acc = this.toolCalls.get(index) ?? { id: '', name: '', arguments: '' };
      if (call.id) acc.id = call.id;
      if (call.function?.name) acc.name += call.function.name;
      if (call.function?.arguments) acc.arguments += call.function.arguments;
      this.toolCalls.set(index, acc);
    }
  }

  /** Résultat complet : tool_calls réassemblés par index, noms ramenés à la forme interne. */
  result(): ChatCompletionResult {
    return {
      content: this.content || null,
      reasoningContent: this.reasoning || null,
      toolCalls: [...this.toolCalls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, acc]) => ({ id: acc.id, name: fromApiToolName(acc.name), arguments: acc.arguments })),
      usage: this.usage,
    };
  }
}

export interface ReadChatStreamCallbacks {
  /** Delta de texte SÛR, au fil de l'eau (jamais un jeton interne du modèle). */
  onDelta?: (text: string) => void;
  /** Un paquet vient d'arriver : sert à réarmer le watchdog d'inactivité. */
  onActivity?: () => void;
}

/**
 * Lit un corps de réponse SSE jusqu'à la fin et renvoie le résultat COMPLET
 * du tour. Les lignes hors `data:` sont ignorées. Si le modèle laisse fuir
 * ses balises internes d'appel d'outil dans le texte, le flux est coupé net
 * et le tour est refusé (LlmFormatLeakError) : rien de toxique n'atteint le callback.
 */
export async function readChatStream(body: ReadableStream<Uint8Array>, callbacks: ReadChatStreamCallbacks = {}): Promise<ChatCompletionResult> {
  const accumulator = new ChatStreamAccumulator();
  const sanitizer = new LlmStreamSanitizer();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    callbacks.onActivity?.();
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith('data:')) continue;
      accumulator.push(line.slice(5).trim(), (text) => {
        const safe = sanitizer.push(text);
        if (!sanitizer.didLeak && safe) callbacks.onDelta?.(safe);
      });
      if (sanitizer.didLeak) {
        await reader.cancel().catch(() => {});
        throw new LlmFormatLeakError((accumulator.result().content ?? '').slice(-80));
      }
    }
  }
  const tail = sanitizer.finish();
  if (tail) callbacks.onDelta?.(tail);
  return accumulator.result();
}
