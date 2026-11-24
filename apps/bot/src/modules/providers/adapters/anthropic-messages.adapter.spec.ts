import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError, type ChatTurnInput, type ProviderConfig } from '../provider.types';
import { AnthropicMessagesAdapter } from './anthropic-messages.adapter';

const BASE = 'https://api.example.test';
const KEY = 'test-key-not-real';
// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne (aussi en fin de display_name).
const NAME = 'name';
const DISPLAY_NAME = `display_${NAME}`;
/** En-têtes attendus sur chaque appel : le protocole plus UN seul en-tête d'authentification. */
const PROTOCOL_HEADERS = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': KEY };

interface FetchCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Remplace fetch : chaque appel est journalisé (URL, méthode, en-têtes, corps) puis routé par le test. */
function stubFetch(route: (call: FetchCall) => Response | undefined) {
  const calls: FetchCall[] = [];
  const mock = vi.fn((input: URL | string, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? init.body : '';
    const call: FetchCall = { url: new URL(String(input)), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: raw ? JSON.parse(raw) : undefined };
    calls.push(call);
    return route(call) ?? new Response('route inattendue', { status: 500 });
  });
  vi.stubGlobal('fetch', mock);
  return { mock, calls };
}

const config = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'p1',
  guildId: 'g1',
  slug: 'anthropic',
  displayName: 'Anthropic',
  protocol: 'anthropic-messages',
  baseUrl: BASE,
  authType: 'bearer',
  authHeaderName: null,
  apiKey: KEY,
  customHeaders: {},
  extraConfig: {},
  models: [],
  enabled: true,
  ...overrides,
});

const turn = (overrides: Partial<ChatTurnInput> = {}): ChatTurnInput => ({ modelId: 'claude-a', messages: [{ role: 'user', content: 'bonjour' }], tools: [], options: { userId: 'u1', guildId: 'g1', cause: 'reply' }, ...overrides });
const MESSAGE = { content: [{ type: 'text', text: 'Salut !' }], usage: { input_tokens: 12, output_tokens: 3 } };
const TOOL_MESSAGE = { content: [{ type: 'text', text: 'Je cherche.' }, { type: 'tool_use', id: 'toolu_1', [NAME]: 'records__create', input: { q: 'x' } }], usage: { input_tokens: 20, output_tokens: 9 } };

/** L'appel doit lever une erreur typée du fournisseur. */
async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }
  return expect.unreachable('l\u0027appel aurait dû lever une erreur');
}

afterEach(() => vi.unstubAllGlobals());

describe('AnthropicMessagesAdapter · en-têtes et modèles', () => {
  it('déclare son protocole et ne sert que la conversation', () => {
    const adapter = new AnthropicMessagesAdapter();
    expect(adapter.protocol).toBe('anthropic-messages');
    expect([...adapter.capabilities]).toEqual(['chat.default', 'chat.reasoning', 'chat.ingestion']);
    expect(adapter.supports('chat.reasoning', config())).toBe(true);
    expect(adapter.supports('image.generate', config())).toBe(false);
  });

  it('testConnection : GET /v1/models avec x-api-key et anthropic-version, un seul en-tête d\u0027authentification', async () => {
    const { calls } = stubFetch(() => json({ data: [{ id: 'claude-a', [DISPLAY_NAME]: 'Claude A', created_at: '2026-01-01T00:00:00Z' }, { id: 'claude-b' }], has_more: false }));
    const check = await new AnthropicMessagesAdapter().testConnection(config());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.href).toBe(`${BASE}/v1/models`);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.headers).toEqual(PROTOCOL_HEADERS);
    expect(check).toEqual({ ok: true, summary: 'Connecté : 2 modèle(s)', modelsFound: 2 });
  });

  it('auth « header » nommée : la clé part dans authHeaderName, jamais en double', async () => {
    const { calls } = stubFetch(() => json({ data: [] }));
    await new AnthropicMessagesAdapter().discoverModels(config({ authType: 'header', authHeaderName: 'x-proxy-key' }));
    expect(calls[0]?.headers).toEqual({ 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-proxy-key': KEY });
  });

  it('404 sur la liste des modèles : connexion tolérée', async () => {
    stubFetch(() => new Response('not found', { status: 404 }));
    expect(await new AnthropicMessagesAdapter().testConnection(config())).toEqual({ ok: true, summary: 'Connecté (liste des modèles non disponible)', modelsFound: 0 });
  });

  it('401 : erreur auth, sans la clé même renvoyée par le fournisseur', async () => {
    stubFetch(() => json({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }, 401));
    const error = await failure(new AnthropicMessagesAdapter().testConnection(config()));
    expect(error.kind).toBe('auth');
    expect(error.status).toBe(401);
    expect(error.message).toContain('invalid x-api-key');
    expect(`${error.message}${String(error)}`).not.toContain(KEY);
  });

  it('discoverModels : suit la pagination (has_more, after_id = last_id)', async () => {
    const { calls } = stubFetch((call) => {
      if (call.url.searchParams.has('after_id')) return json({ data: [{ id: 'm3' }], has_more: false });
      return json({ data: [{ id: 'm1', [DISPLAY_NAME]: 'M1' }, { id: 'm2' }], has_more: true, last_id: 'm2' });
    });
    expect(await new AnthropicMessagesAdapter().discoverModels(config())).toEqual([
      { id: 'm1', [NAME]: 'M1', kind: 'chat' },
      { id: 'm2', [NAME]: 'm2', kind: 'chat' },
      { id: 'm3', [NAME]: 'm3', kind: 'chat' },
    ]);
    expect(calls.map((call) => call.url.href)).toEqual([`${BASE}/v1/models`, `${BASE}/v1/models?after_id=m2`]);
  });
});

describe('AnthropicMessagesAdapter · conversation', () => {
  it('chat : POST /v1/messages, corps traduit, max_tokens par défaut, réponse au format interne', async () => {
    const { calls } = stubFetch(() => json(MESSAGE));
    const result = await new AnthropicMessagesAdapter().chat(config(), turn());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.href).toBe(`${BASE}/v1/messages`);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers).toEqual(PROTOCOL_HEADERS);
    expect(calls[0]?.body).toEqual({ model: 'claude-a', max_tokens: 4096, messages: [{ role: 'user', content: [{ type: 'text', text: 'bonjour' }] }] });
    expect(result).toEqual({ content: 'Salut !', reasoningContent: null, toolCalls: [], usage: { promptTokens: 12, completionTokens: 3 } });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('max_tokens vient de extraConfig.maxTokens quand la valeur est valide', async () => {
    const first = stubFetch(() => json(MESSAGE));
    await new AnthropicMessagesAdapter().chat(config({ extraConfig: { maxTokens: 256 } }), turn());
    expect(first.calls[0]?.body).toMatchObject({ max_tokens: 256 });
    const second = stubFetch(() => json(MESSAGE));
    await new AnthropicMessagesAdapter().chat(config({ extraConfig: { maxTokens: 0 } }), turn());
    expect(second.calls[0]?.body).toMatchObject({ max_tokens: 4096 });
  });

  it('un seul delta pour une réponse en texte, aucun quand le modèle appelle un outil', async () => {
    stubFetch(() => json(MESSAGE));
    const onDelta = vi.fn();
    await new AnthropicMessagesAdapter().chat(config(), turn({ onDelta }));
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith('Salut !');
    stubFetch(() => json(TOOL_MESSAGE));
    const toolDelta = vi.fn();
    const result = await new AnthropicMessagesAdapter().chat(config(), turn({ onDelta: toolDelta }));
    expect(toolDelta).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual([{ id: 'toolu_1', [NAME]: 'records.create', arguments: '{"q":"x"}' }]);
  });

  it('erreur 400 : le message du corps est repris, la clé masquée', async () => {
    stubFetch(() => json({ type: 'error', error: { type: 'invalid_request_error', message: `max_tokens: ${KEY} is not valid` } }, 400));
    const error = await failure(new AnthropicMessagesAdapter().chat(config(), turn()));
    expect(error.kind).toBe('http');
    expect(error.status).toBe(400);
    expect(error.message).toBe('HTTP 400 : max_tokens: [clé masquée] is not valid');
  });

  it('erreur 529 (surchargé) : indisponible, donc éligible à la bascule', async () => {
    stubFetch(() => json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529));
    const error = await failure(new AnthropicMessagesAdapter().chat(config(), turn()));
    expect(error.kind).toBe('unavailable');
    expect(error.message).toContain('Overloaded');
  });

  it('une clé recopiée par le fournisseur dans une réponse réussie n\u0027est jamais rendue ni diffusée', async () => {
    stubFetch(() => json({ content: [{ type: 'text', text: `voici ${KEY}` }], usage: { input_tokens: 1, output_tokens: 1 } }));
    const onDelta = vi.fn();
    const error = await failure(new AnthropicMessagesAdapter().chat(config(), turn({ onDelta })));
    expect(error.kind).toBe('http');
    expect(onDelta).not.toHaveBeenCalled();
    expect(`${error.message}${String(error)}`).not.toContain(KEY);
  });

  it('un catalogue de modèles qui recopie la clé est refusé', async () => {
    stubFetch(() => json({ data: [{ id: 'm1', [DISPLAY_NAME]: `modèle ${KEY}` }], has_more: false }));
    const error = await failure(new AnthropicMessagesAdapter().discoverModels(config()));
    expect(`${error.message}${String(error)}`).not.toContain(KEY);
  });

  it('execute : capacité non servie, aucune requête', async () => {
    const { mock } = stubFetch(() => json({}));
    const error = await failure(new AnthropicMessagesAdapter().execute(config(), { capability: 'image.generate', modelId: 'x', params: {} }));
    expect(error.kind).toBe('unsupported');
    expect(mock).not.toHaveBeenCalled();
  });
});
