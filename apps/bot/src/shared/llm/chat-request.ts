import type { ChatMessage, ChatOptions, OpenAiTool } from './chat-contract';
import { isDeepSeekHost, stripLoneSurrogates, toApiToolName } from './chat-utils';

/** Encode les noms de tools pour l'API (points interdits), l'ordre est conservé. */
export function encodeApiTools(tools: OpenAiTool[]): OpenAiTool[] {
  return tools.map((tool) => ({
    ...tool,
    function: { ...tool.function, name: toApiToolName(tool.function.name) },
  }));
}

/** Messages nettoyés des surrogate pairs isolés (contenu non textuel laissé tel quel). */
function cleanMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    content: typeof message.content === 'string' ? stripLoneSurrogates(message.content) : message.content,
  }));
}

export interface ChatRequestBodyInput {
  model: string;
  messages: ChatMessage[];
  apiTools: OpenAiTool[];
  options: ChatOptions;
  /** Valeur de reasoning_effort, ou null pour omettre le champ (endpoints non compatibles). */
  reasoningEffort: string | null;
  /** Vrai pour un appel en streaming (demande aussi l'usage en fin de flux). */
  stream?: boolean;
  /** Hôte (ou URL de base) du fournisseur : décide les champs réservés à certains endpoints. */
  host?: string | null;
}

/**
 * Corps de la requête chat/completions. Les champs optionnels sont OMIS (et
 * non envoyés vides) : `reasoning_effort` et `tools` sont rejetés en 400 par
 * plusieurs endpoints compatibles OpenAI quand ils sont présents à vide.
 * `user_id` n'est pas standard : un endpoint OpenAI strict le refuse, il ne
 * part que vers DeepSeek (seul hôte où il est accepté, et utile au suivi d'usage).
 */
export function buildChatRequestBody(input: ChatRequestBodyInput): Record<string, unknown> {
  const { model, messages, apiTools, options, reasoningEffort, stream, host } = input;
  const toolChoice = options.toolChoice ?? 'auto';
  return {
    model,
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    messages: cleanMessages(messages),
    ...(host && isDeepSeekHost(host) ? { user_id: options.guildId ?? options.userId } : {}),
    // Thinking adaptatif : champ omis selon le mode serveur et le type de tour
    // (voir llm-thinking) et sur les endpoints non compatibles.
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(apiTools.length > 0 ? { tools: apiTools, tool_choice: toolChoice } : {}),
  };
}
