import type { ChatCompletionResult, ChatMessage, ToolCallRequest } from '../../../shared/llm/chat-contract';
import { fromApiToolName, toApiToolName } from '../../../shared/llm/chat-utils';
import { ProviderError, type ChatTurnInput } from '../provider.types';

/**
 * Traduction entre le format interne du bot (messages façon OpenAI) et l'API
 * native d'Anthropic (`POST /v1/messages`). Fonctions pures, sans effet de
 * bord. L'API EXIGE : des tours qui alternent (deux messages de même rôle
 * consécutifs sont refusés), une conversation ouverte par `user`, aucun bloc
 * texte vide, et chaque `tool_result` dans le `user` qui suit ses `tool_use`.
 */

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Corps de `POST /v1/messages` tel que l'adaptateur l'envoie. */
export interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  /** Un bloc par message system (l'API n'accepte pas un tableau de chaînes). */
  system?: AnthropicTextBlock[];
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' };
}

const START_PLACEHOLDER = '(début)';
const CONTINUE_PLACEHOLDER = '(suite)';
const NO_RESULT_PLACEHOLDER = '(sans résultat)';

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isToolResult(block: AnthropicContentBlock): block is AnthropicToolResultBlock {
  return block.type === 'tool_result';
}

/** Un bloc texte vide est refusé par l'API : un message user sans contenu est omis. */
function userBlocks(message: ChatMessage): AnthropicContentBlock[] {
  return message.content.trim() ? [{ type: 'text', text: message.content }] : [];
}

/** Arguments d'un appel (chaîne JSON écrite par le modèle) → objet attendu par un bloc `tool_use`. */
function toolInput(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function assistantBlocks(message: ChatMessage): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  if (message.content.trim()) blocks.push({ type: 'text', text: message.content });
  for (const call of message.tool_calls ?? []) {
    blocks.push({ type: 'tool_use', id: call.id, name: toApiToolName(call.function.name), input: toolInput(call.function.arguments) });
  }
  // Ni texte ni appel : un bloc texte vide est interdit, on garde la trace du tour.
  if (blocks.length === 0) blocks.push({ type: 'text', text: CONTINUE_PLACEHOLDER });
  return blocks;
}

function toolResultBlock(message: ChatMessage): AnthropicContentBlock {
  if (!message.tool_call_id) {
    throw new ProviderError('Historique incohérent : un résultat d\u0027outil sans identifiant d\u0027appel.', 'invalid');
  }
  return { type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content || NO_RESULT_PLACEHOLDER };
}

/** Tours fusionnés : les résultats d'outils d'abord (ils répondent aux `tool_use` du tour assistant précédent), puis les textes. */
function mergeBlocks(previous: AnthropicContentBlock[], added: AnthropicContentBlock[]): AnthropicContentBlock[] {
  const all = [...previous, ...added];
  return [...all.filter(isToolResult), ...all.filter((block) => !isToolResult(block))];
}

/**
 * Historique interne → corps `/v1/messages`. Les messages `system` remontent
 * dans `system` ; les résultats d'outils deviennent des blocs `tool_result`
 * portés par des messages `user` ; deux tours consécutifs de même rôle sont
 * fusionnés ; la conversation s'ouvre toujours par `user`.
 */
export function toAnthropicRequest(turn: ChatTurnInput, maxTokens: number): AnthropicRequestBody {
  const system: AnthropicTextBlock[] = [];
  const messages: AnthropicMessage[] = [];
  for (const message of turn.messages) {
    if (message.role === 'system') {
      if (message.content.trim()) system.push({ type: 'text', text: message.content });
      continue;
    }
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const blocks = message.role === 'assistant' ? assistantBlocks(message) : message.role === 'tool' ? [toolResultBlock(message)] : userBlocks(message);
    if (blocks.length === 0) continue;
    const previous = messages.at(-1);
    if (previous?.role === role) previous.content = mergeBlocks(previous.content, blocks);
    else messages.push({ role, content: blocks });
  }
  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: [{ type: 'text', text: START_PLACEHOLDER }] });

  const tools: AnthropicTool[] = turn.tools.map((tool) => ({
    name: toApiToolName(tool.function.name),
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
  // `tool_choice` n'existe qu'avec `tools` : sans outil (synthèse forcée), aucun des deux n'est envoyé.
  const withTools = tools.length > 0 && turn.options.toolChoice !== 'none';
  return {
    model: turn.modelId,
    max_tokens: maxTokens,
    ...(system.length > 0 ? { system } : {}),
    messages,
    ...(withTools ? { tools, tool_choice: { type: 'auto' } } : {}),
  };
}

/**
 * Réponse `/v1/messages` → format interne du bot. Les blocs `text` sont
 * concaténés, chaque `tool_use` devient un appel d'outil (arguments
 * re-sérialisés), l'usage est converti.
 */
export function fromAnthropicResponse(payload: unknown): ChatCompletionResult {
  const root = asRecord(payload);
  let text = '';
  const toolCalls: ToolCallRequest[] = [];
  for (const entry of asList(root.content)) {
    const block = asRecord(entry);
    if (block.type === 'text' && typeof block.text === 'string') {
      text += block.text;
    } else if (block.type === 'tool_use' && typeof block.id === 'string') {
      toolCalls.push({ id: block.id, name: fromApiToolName(typeof block.name === 'string' ? block.name : ''), arguments: JSON.stringify(asRecord(block.input)) });
    }
  }
  const usage = asRecord(root.usage);
  const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined;
  return {
    content: text || null,
    reasoningContent: null,
    toolCalls,
    ...(inputTokens !== undefined ? { usage: { promptTokens: inputTokens, completionTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0 } } : {}),
  };
}
