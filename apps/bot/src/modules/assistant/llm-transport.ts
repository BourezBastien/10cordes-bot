import { Logger } from '@spraxium/logger';
import { buildChatRequestBody, encodeApiTools } from '../../shared/llm/chat-request';
import { parseChatCompletion } from '../../shared/llm/chat-response';
import type { ChatCause, ChatCompletionResult, ChatMessage, ChatOptions, OpenAiTool } from '../../shared/llm/chat-contract';
import { LlmFormatLeakError } from '../../shared/llm/format-leak.error';
import { containsInternalTokens } from '../../shared/llm/internal-tokens';
import { safeFetch } from '../../shared/utils/safe-fetch';
import { STREAMABLE_CHAT_PROTOCOLS } from '../providers/provider-protocols';
import type { ChatEndpoint } from './llm-endpoint';
import { ProviderHttpError, ProviderTimeoutError, ProviderUnavailableError, throwProviderError } from './llm.errors';
import { readChatStream } from './llm-stream.reader';
import type { ReasoningEffortPlanner } from './llm-thinking.planner';

const log = new Logger('Llm');

/** Streaming : le flux est coupé après ce délai sans paquet. */
const STREAM_INACTIVITY_MS = 30_000;
const STREAM_STALLED_MESSAGE = 'Le modèle IA a cessé d\u2019émettre (30 s sans donnée) : connexion annulée.';

/**
 * Une panne du transport (hôte injoignable, connexion coupée, délai) devient
 * une erreur typée : repli possible et message juste pour l'utilisateur.
 * `fetch` échoue en réseau par un TypeError portant une cause ; les autres
 * erreurs passent telles quelles.
 */
function transportFailure(error: unknown): Error {
  if (error instanceof TypeError && 'cause' in error) return new ProviderUnavailableError();
  if (error instanceof Error && /timeout|abort/iu.test(error.name)) return new ProviderTimeoutError();
  throw error;
}

export interface ChatTurnCallbacks {
  /** Delta de texte SÛR (jamais un jeton interne du modèle). */
  onDelta?: (text: string) => void;
}

/** Un tour à envoyer sur un endpoint. */
export interface ChatTurn {
  messages: ChatMessage[];
  tools: OpenAiTool[];
  options: ChatOptions;
  /** true : les deltas partent au fil de l'eau (SSE) ; false : une seule réponse. */
  stream: boolean;
  /** Délai de l'appel bloquant. */
  timeoutMs: number;
  /** Durée maximale de l'échange, décidée par l'appelant. */
  signal?: AbortSignal;
}

/**
 * Échange HTTP d'un tour de conversation. Les protocoles compatibles sont
 * servis ici (SSE « chat/completions », corps de requête, refus de
 * `reasoning_effort`, watchdog d'inactivité) ; les autres passent par
 * l'adaptateur de leur protocole. Ne détient aucune configuration : tout
 * arrive dans l'endpoint, rien n'en ressort (en-têtes compris).
 */
export class ChatTransport {
  /** Hôtes ayant refusé le champ `reasoning_effort` (400) : il n'y est plus envoyé. */
  private readonly effortRejectedHosts = new Set<string>();

  constructor(private readonly deps: { effortPlanner: ReasoningEffortPlanner; onLeak: (cause: ChatCause, error: LlmFormatLeakError) => void }) {}

  async send(endpoint: ChatEndpoint, turn: ChatTurn, callbacks: ChatTurnCallbacks = {}): Promise<ChatCompletionResult> {
    if (!STREAMABLE_CHAT_PROTOCOLS.has(endpoint.protocol)) return this.viaAdapter(endpoint, turn, callbacks);
    // Le corps est construit dans la tentative : un endpoint qui refuse
    // `reasoning_effort` (400) fait rejouer l'appel une fois, sans le champ.
    return this.withEffortCompat(endpoint.host, async () => {
      const body = await this.requestBody(endpoint, turn);
      return turn.stream ? this.stream(endpoint, body, callbacks, turn.signal) : this.blocked(endpoint, body, turn.options.cause, turn.timeoutMs);
    });
  }

  /**
   * Protocole sans SSE « chat/completions » (Anthropic Messages...) :
   * l'adaptateur exécute le tour. S'il ne streame pas, le texte arrive en un bloc.
   */
  private async viaAdapter(endpoint: ChatEndpoint, turn: ChatTurn, callbacks: ChatTurnCallbacks): Promise<ChatCompletionResult> {
    const attempt = endpoint.attempt;
    if (!attempt) throw new Error(`Aucun adaptateur pour le protocole ${endpoint.protocol}.`);
    let streamed = false;
    const completion = await attempt.adapter.chat(attempt.provider, {
      modelId: endpoint.model,
      messages: turn.messages,
      tools: turn.tools,
      options: turn.options,
      onDelta: (text) => {
        streamed = true;
        callbacks.onDelta?.(text);
      },
    });
    if (completion.content && containsInternalTokens(completion.content)) {
      const leak = new LlmFormatLeakError(completion.content.slice(0, 80));
      this.deps.onLeak(turn.options.cause, leak);
      throw leak;
    }
    if (!streamed && completion.content) callbacks.onDelta?.(completion.content);
    return completion;
  }

  /** Appel bloquant : réponse complète, fuite de balises internes refusée. */
  private async blocked(endpoint: ChatEndpoint, body: Record<string, unknown>, cause: ChatCause, timeoutMs: number): Promise<ChatCompletionResult> {
    const response = await safeFetch(endpoint.url, { timeoutMs, method: 'POST', headers: endpoint.headers, body: JSON.stringify(body) }).catch((error: unknown) => {
      throw transportFailure(error);
    });
    if (!response.ok) throwProviderError(response.status, await response.text().catch(() => ''), response);
    return parseChatCompletion(await response.json(), (leak) => this.deps.onLeak(cause, leak));
  }

  /** Appel en streaming SSE, coupé après `STREAM_INACTIVITY_MS` sans paquet. */
  private async stream(endpoint: ChatEndpoint, body: Record<string, unknown>, callbacks: ChatTurnCallbacks, signal?: AbortSignal): Promise<ChatCompletionResult> {
    const stalled = new AbortController();
    let inactivityTimer = setTimeout(() => stalled.abort(), STREAM_INACTIVITY_MS);
    const rearm = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => stalled.abort(), STREAM_INACTIVITY_MS);
    };
    try {
      // La durée de l'échange est décidée par l'appelant (`signal`, 180 s au total) : pas de délai propre ici.
      const response = await safeFetch(endpoint.url, {
        method: 'POST',
        timeoutMs: null,
        signal: signal ? AbortSignal.any([signal, stalled.signal]) : stalled.signal,
        headers: endpoint.headers,
        body: JSON.stringify(body),
      }).catch((error: unknown) => {
        throw transportFailure(error);
      });
      if (!response.ok) throwProviderError(response.status, await response.text().catch(() => ''), response);
      if (!response.body) throw new Error('Streaming non supporté par le fournisseur (body absent).');
      return await readChatStream(response.body, { onDelta: callbacks.onDelta, onActivity: rearm }).catch((error: unknown) => {
        throw transportFailure(error);
      });
    } catch (error) {
      if (stalled.signal.aborted) throw new ProviderTimeoutError(STREAM_STALLED_MESSAGE);
      throw error;
    } finally {
      clearTimeout(inactivityTimer);
    }
  }

  /** Effort d'un tour : la valeur décidée pour la requête, sinon la décision d'un appel isolé (sans tools). */
  private async requestBody(endpoint: ChatEndpoint, turn: ChatTurn): Promise<Record<string, unknown>> {
    const { options, tools, messages, stream } = turn;
    const reasoningEffort = this.effortRejectedHosts.has(endpoint.host)
      ? null
      : options.reasoningEffort !== undefined
        ? options.reasoningEffort
        : await this.deps.effortPlanner.plan(options, false, endpoint.route ? endpoint.route.provider.baseUrl : undefined);
    return buildChatRequestBody({ model: endpoint.model, messages, apiTools: encodeApiTools(tools), options, reasoningEffort, stream, host: endpoint.host });
  }

  /** Rejoue une fois l'appel quand l'endpoint refuse le champ `reasoning_effort` (400 explicite). */
  private async withEffortCompat<T>(host: string, attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (error) {
      if (this.effortRejectedHosts.has(host) || !(error instanceof ProviderHttpError) || error.status !== 400 || !/reasoning_effort/iu.test(error.detail)) {
        throw error;
      }
      this.effortRejectedHosts.add(host);
      log.warn(`l'endpoint ${host} refuse le champ reasoning_effort (400) : il est omis désormais`);
      return attempt();
    }
  }
}
