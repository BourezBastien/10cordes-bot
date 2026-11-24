import { type ChatMessage, type OpenAiTool } from '../../../shared/llm/chat-contract';
import { buildChatRequestBody, encodeApiTools } from '../../../shared/llm/chat-request';
import { parseChatCompletion } from '../../../shared/llm/chat-response';
import { fileLog } from '../../logging/file-log.service';
import { normalizeProviderUrl, providerFetch, readJson } from '../provider-http';
import {
  ProviderError,
  type ChatResult,
  type ChatTurnInput,
  type ProviderConfig,
  type ProviderExecutionResult,
  type ProviderRequest,
} from '../provider.types';
import { optionalText } from './openai-compatible.common';
import { assertProviderOk, redactDeep } from './generic-http.errors';

/** Même délai que le client LLM d'origine (appel bloquant). */
const CHAT_TIMEOUT_MS = 60_000;

/**
 * Seul deepseek.com (et ses sous-domaines) accepte `reasoning_effort` en mode
 * compatible OpenAI, même règle que le client LLM. Ailleurs le champ est
 * omis : plusieurs endpoints le rejettent en 400.
 */
function acceptsReasoningEffort(baseUrl: string): boolean {
  try {
    const host = new URL(normalizeProviderUrl(baseUrl)).hostname.toLowerCase();
    return host === 'deepseek.com' || host.endsWith('.deepseek.com');
  } catch {
    return false;
  }
}

/** Un tour sans choix lisible est une panne du fournisseur, pas une réponse vide. */
function readableCompletion(payload: unknown): unknown {
  const choices = (payload as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices)) {
    throw new ProviderError('Le fournisseur a renvoyé une réponse de conversation illisible.', 'unavailable');
  }
  return payload;
}

/**
 * POST /chat/completions, bloquant. `onDelta` reçoit le texte une fois :
 * un pont pour les consommateurs qui attendent un flux.
 */
export async function postChatCompletion(config: ProviderConfig, turn: ChatTurnInput, signal?: AbortSignal): Promise<ChatResult> {
  const { messages, options, tools } = turn;
  const response = await providerFetch(config, '/chat/completions', {
    method: 'POST',
    timeoutMs: CHAT_TIMEOUT_MS,
    signal,
    body: JSON.stringify(
      buildChatRequestBody({
        model: turn.modelId,
        messages,
        apiTools: encodeApiTools(tools),
        options,
        reasoningEffort: acceptsReasoningEffort(config.baseUrl) ? (options.reasoningEffort ?? null) : null,
        host: config.baseUrl,
      }),
    ),
  });
  await assertProviderOk(response, config);
  const result = redactDeep(
    parseChatCompletion(readableCompletion(await readJson(response)), (leak) =>
      fileLog()?.event('warn', 'llm', 'format_leak', { cause: options.cause, sample: leak.sample }),
    ),
    config.apiKey,
  );
  if (turn.onDelta && result.content && result.toolCalls.length === 0) turn.onDelta(result.content);
  return result;
}

/** Capacité `chat.*` hors de la boucle de l'agent (ingestion, mémoire) : mêmes appels, cause « consolidation ». */
export async function executeChatCapability(
  config: ProviderConfig,
  request: ProviderRequest,
  signal?: AbortSignal,
): Promise<ProviderExecutionResult> {
  const { params } = request;
  if (!Array.isArray(params.messages)) {
    throw new ProviderError('Paramètre manquant ou invalide : messages (liste de messages).', 'invalid');
  }
  if (params.tools !== undefined && !Array.isArray(params.tools)) {
    throw new ProviderError('Paramètre invalide : tools (liste attendue).', 'invalid');
  }
  const result = await postChatCompletion(
    config,
    {
      modelId: request.modelId,
      messages: params.messages as ChatMessage[],
      tools: (params.tools ?? []) as OpenAiTool[],
      options: {
        userId: optionalText(params, 'userId') ?? 'system',
        guildId: optionalText(params, 'guildId') ?? null,
        cause: 'consolidation',
        reasoningEffort: optionalText(params, 'reasoningEffort'),
      },
    },
    signal,
  );
  const summary =
    result.toolCalls.length > 0 ? `${result.toolCalls.length} appel(s) d\u0027outil demandé(s).` : `Réponse reçue (${result.content?.length ?? 0} caractères).`;
  return { ok: true, summary, data: { content: result.content, toolCalls: result.toolCalls, usage: result.usage } };
}
