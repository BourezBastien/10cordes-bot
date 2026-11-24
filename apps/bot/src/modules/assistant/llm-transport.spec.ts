import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmFormatLeakError } from '../../shared/llm/format-leak.error';
import type { AbstractProviderAdapter } from '../providers/provider-adapter';
import type { ProviderConfig } from '../providers/provider.types';
import type { ChatEndpoint } from './llm-endpoint';
import { ProviderAuthError, ProviderHttpError, ProviderTimeoutError, ProviderUnavailableError, isFallbackWorthy } from './llm.errors';
import { ChatTransport, type ChatTurn } from './llm-transport';
import type { ReasoningEffortPlanner } from './llm-thinking.planner';

// La garde des requêtes résout l'hôte avant chaque appel : résolution simulée, pour que les horloges simulées restent maîtresses du temps.
const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));

/**
 * Échange HTTP d'un tour de conversation : corps envoyé, streaming, refus de
 * `reasoning_effort`, watchdog d'inactivité, et pont vers l'adaptateur des
 * protocoles sans SSE. Le `fetch` global est remplacé : la garde du socle
 * (https, hôte public) reste réelle.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const URL_ = 'https://api.example.test/v1/chat/completions';
const LEAK = 'je lance <|tool_call|>{"name":"x"}';

function endpoint(overrides: Partial<ChatEndpoint> = {}): ChatEndpoint {
  return {
    host: 'api.example.test',
    protocol: 'openai-chat',
    model: 'm-1',
    url: URL_,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    route: null,
    attempt: null,
    ...overrides,
  };
}

function turn(overrides: Partial<ChatTurn> = {}): ChatTurn {
  return {
    messages: [{ role: 'user', content: 'bonjour' }],
    tools: [],
    options: { userId: 'u', guildId: null, cause: 'reply', reasoningEffort: null },
    stream: true,
    timeoutMs: 5_000,
    ...overrides,
  };
}

function sse(text: string): Response {
  const encoder = new TextEncoder();
  const chunks = [`data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n`, 'data: [DONE]\n\n'];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const completion = (content: string): Response => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 });

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

/** Adaptateur sans état : `run` décide ce qu'il fait du tour (émettre, échouer). */
function bridge(run: (turn: { onDelta?: (text: string) => void }) => Promise<void>, content: string | null = 'Réponse') {
  return {
    chat: vi.fn(async (_config: ProviderConfig, input: { onDelta?: (text: string) => void }) => {
      await run(input);
      return { content, reasoningContent: null, toolCalls: [] };
    }),
  } as unknown as AbstractProviderAdapter & { chat: ReturnType<typeof vi.fn> };
}

const fetchMock = vi.fn<typeof fetch>();

function transport() {
  const effortPlanner = { plan: vi.fn(async () => null) } as unknown as ReasoningEffortPlanner;
  const onLeak = vi.fn();
  return { subject: new ChatTransport({ effortPlanner, onLeak }), onLeak, effortPlanner };
}

beforeEach(() => {
  fetchMock.mockReset();
  dns.lookup.mockResolvedValue([{ address: '104.18.1.2' }]);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  dns.lookup.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ChatTransport · protocoles servis en direct', () => {
  it('streaming : POST à l\u0027URL de l\u0027endpoint, avec ses en-têtes, le texte part au fil de l\u0027eau', async () => {
    fetchMock.mockResolvedValue(sse('Salut'));
    const { subject } = transport();
    const onDelta = vi.fn();
    const result = await subject.send(endpoint(), turn(), { onDelta });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(URL_);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` });
    expect(bodyOf(init)).toMatchObject({ model: 'm-1', stream: true, messages: [{ role: 'user', content: 'bonjour' }] });
    expect(onDelta).toHaveBeenCalledWith('Salut');
    expect(result.content).toBe('Salut');
  });

  it('le corps porte le modèle de la route, jamais celui de l\u0027instance', async () => {
    fetchMock.mockResolvedValue(sse('ok'));
    await transport().subject.send(endpoint({ model: 'autre-modele' }), turn());
    expect(bodyOf(fetchMock.mock.calls[0]?.[1]).model).toBe('autre-modele');
  });

  it('appel bloquant : une seule réponse, analysée', async () => {
    fetchMock.mockResolvedValue(completion('Voici.'));
    const result = await transport().subject.send(endpoint(), turn({ stream: false }));
    expect(bodyOf(fetchMock.mock.calls[0]?.[1])).not.toHaveProperty('stream');
    expect(result).toMatchObject({ content: 'Voici.', usage: { promptTokens: 3, completionTokens: 2 } });
  });

  it('un 429 ressort typé, et invite au repli ; une clé refusée n\u0027y invite pas', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"rate limited"}', { status: 429 }));
    const { subject } = transport();
    const rateLimit = await subject.send(endpoint(), turn()).catch((error: unknown) => error);
    expect(rateLimit).toBeInstanceOf(ProviderHttpError);
    expect(isFallbackWorthy(rateLimit)).toBe(true);

    fetchMock.mockResolvedValueOnce(new Response('{"error":"bad key"}', { status: 401 }));
    const refused = await subject.send(endpoint(), turn()).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ProviderAuthError);
    expect(isFallbackWorthy(refused)).toBe(false);
  });

  it('l\u0027endpoint refuse reasoning_effort : l\u0027appel est rejoué sans lui, et le champ n\u0027y part plus', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":{"message":"Unrecognized field: reasoning_effort"}}', { status: 400 }))
      .mockResolvedValueOnce(sse('ok'))
      .mockResolvedValueOnce(sse('encore ok'));
    const { subject } = transport();
    const options = { userId: 'u', guildId: null, cause: 'reply' as const, reasoningEffort: 'low' };
    await subject.send(endpoint(), turn({ options }));
    expect(bodyOf(fetchMock.mock.calls[0]?.[1])).toHaveProperty('reasoning_effort', 'low');
    expect(bodyOf(fetchMock.mock.calls[1]?.[1])).not.toHaveProperty('reasoning_effort');
    await subject.send(endpoint({ host: 'autre.example.test', url: 'https://autre.example.test/v1/chat/completions' }), turn({ options }));
    expect(bodyOf(fetchMock.mock.calls[2]?.[1])).toHaveProperty('reasoning_effort', 'low');
  });

  it('un autre 400 n\u0027est jamais rejoué', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":{"message":"bad messages"}}', { status: 400 }));
    await expect(transport().subject.send(endpoint(), turn())).rejects.toBeInstanceOf(ProviderHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un flux qui se tait 30 secondes est coupé net : erreur typée, qui invite au repli', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise((resolve) => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
            },
          });
          resolve(new Response(body, { status: 200 }));
        }),
    );
    const { subject } = transport();
    // L'attente s'attache AVANT d'avancer les horloges : la promesse rejette pendant ce temps.
    const outcome = subject.send(endpoint(), turn()).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    const failure = await outcome;
    expect(failure).toBeInstanceOf(ProviderTimeoutError);
    expect((failure as Error).message).toContain('a cessé d\u2019émettre');
    expect(isFallbackWorthy(failure)).toBe(true);
  });

  it('une panne réseau ressort en erreur typée (repli possible), jamais en erreur brute du runtime', async () => {
    fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND api.example.test') }));
    const failure = await transport().subject.send(endpoint(), turn()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailableError);
    expect((failure as Error).message).not.toContain('ENOTFOUND');
    expect(isFallbackWorthy(failure)).toBe(true);
  });

  it('appel bloquant : un délai dépassé ressort en erreur typée', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    const failure = await transport().subject.send(endpoint(), turn({ stream: false })).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderTimeoutError);
  });

  it('une URL refusée par la garde sortante garde son message : ce n\u0027est pas une panne du fournisseur', async () => {
    const failure = await transport().subject.send(endpoint({ url: 'http://api.example.test/v1/chat/completions' }), turn({ stream: false })).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ProviderUnavailableError);
    expect((failure as Error).message).toContain('https');
  });
});

describe('ChatTransport · protocole sans SSE, par l\u0027adaptateur', () => {
  const anthropic = (adapter: unknown): ChatEndpoint =>
    endpoint({
      protocol: 'anthropic-messages',
      host: 'api.anthropic.com',
      model: 'claude-sonnet',
      attempt: { provider: { apiKey: `${KEY}-claude` } as ProviderConfig, adapter: adapter as AbstractProviderAdapter },
    });

  it('l\u0027adaptateur reçoit le fournisseur et le modèle ; son texte arrive en un bloc si lui-même ne streame pas', async () => {
    const adapter = bridge(async () => undefined);
    const onDelta = vi.fn();
    const result = await transport().subject.send(anthropic(adapter), turn(), { onDelta });
    expect(adapter.chat).toHaveBeenCalledTimes(1);
    expect(adapter.chat.mock.calls[0]?.[0]).toMatchObject({ apiKey: `${KEY}-claude` });
    expect(adapter.chat.mock.calls[0]?.[1]).toMatchObject({ modelId: 'claude-sonnet' });
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith('Réponse');
    expect(result.content).toBe('Réponse');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si l\u0027adaptateur streame, son texte n\u0027est pas répété', async () => {
    const adapter = bridge(async (input) => {
      input.onDelta?.('Ré');
      input.onDelta?.('ponse');
    });
    const onDelta = vi.fn();
    await transport().subject.send(anthropic(adapter), turn(), { onDelta });
    expect(onDelta.mock.calls.map(([text]) => text)).toEqual(['Ré', 'ponse']);
  });

  it('une réponse de l\u0027adaptateur qui laisse fuir ses balises internes est refusée avant publication', async () => {
    const adapter = bridge(async () => undefined, LEAK);
    const { subject, onLeak } = transport();
    const onDelta = vi.fn();
    const failure = await subject.send(anthropic(adapter), turn(), { onDelta }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LlmFormatLeakError);
    expect(onLeak).toHaveBeenCalledWith('reply', failure);
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('l\u0027échec de l\u0027adaptateur remonté tel quel', async () => {
    const adapter = bridge(async () => {
      throw new Error('Anthropic indisponible');
    });
    await expect(transport().subject.send(anthropic(adapter), turn())).rejects.toThrow('Anthropic indisponible');
  });
});

describe('ChatTransport · effort d\u0027un appel isolé', () => {
  it('sans décision de requête, l\u0027effort se décide contre l\u0027URL du fournisseur du tour', async () => {
    fetchMock.mockResolvedValue(sse('ok'));
    const { subject, effortPlanner } = transport();
    const options = { userId: 'u', guildId: null, cause: 'reply' as const };
    await subject.send(endpoint(), turn({ options }));
    expect(effortPlanner.plan).toHaveBeenCalledWith(options, false, undefined);
  });
});
