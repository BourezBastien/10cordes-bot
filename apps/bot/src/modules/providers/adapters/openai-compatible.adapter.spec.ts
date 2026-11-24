import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAiTool } from '../../../shared/llm/chat-contract';
import { LlmFormatLeakError } from '../../../shared/llm/format-leak.error';
import { ProviderError, type ChatTurnInput, type ProviderConfig } from '../provider.types';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter';

// Clés calculées : sync-tool-names.mjs repère une clé `name` (aussi en fin de `displayName`) suivie d'une chaîne.
const NAME = 'name';
const DISPLAY_NAME = 'displayName';
const KEY = 'test-key-not-real';
const BASE = 'https://api.example.test/v1';

/**
 * Protocole « compatible OpenAI » : URLs appelées, en-têtes, corps, erreurs
 * typées. Le `fetch` global est remplacé : la garde du socle (https, hôte
 * public) et l'authentification restent réelles.
 */

const fetchMock = vi.fn<typeof fetch>();
const adapter = new OpenAiCompatibleAdapter();

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    guildId: 'guild-1',
    slug: 'example',
    [DISPLAY_NAME]: 'Example',
    protocol: 'openai-chat',
    baseUrl: BASE,
    authType: 'bearer',
    authHeaderName: null,
    apiKey: KEY,
    customHeaders: {},
    extraConfig: {},
    models: [],
    enabled: true,
    ...overrides,
  };
}

const reply = (body: unknown, status = 200, headers: Record<string, string> = { 'content-type': 'application/json' }): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

/** Chaque appel reçoit une Response neuve : un corps ne se lit qu'une fois. */
const serve = (body: unknown, status = 200, headers?: Record<string, string>): void => {
  fetchMock.mockImplementation(async () => reply(body, status, headers));
};

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('aucun appel fetch');
  return { url: String(call[0]), init: call[1] ?? {} };
}

const bodyOf = (init: RequestInit): Record<string, unknown> => JSON.parse(String(init.body)) as Record<string, unknown>;
const headersOf = (init: RequestInit): Record<string, string> => init.headers as Record<string, string>;

/** L'erreur typée attendue. Aucun message d'erreur ne porte la clé : ni le message, ni la pile, ni les champs. */
async function failure(run: () => Promise<unknown>): Promise<ProviderError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    expect(JSON.stringify({ error, message: (error as Error).message, stack: (error as Error).stack })).not.toContain(KEY);
    return error as ProviderError;
  }
  throw new Error('appel réussi alors qu\u0027un échec était attendu');
}

const completion = (content: string | null, toolCalls?: unknown[]): unknown => ({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  choices: [{ index: 0, message: { role: 'assistant', content, tool_calls: toolCalls ?? null }, finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
});
const TOOL_CALL = { id: 'call_1', type: 'function', function: { [NAME]: 'records__create', arguments: '{"note":"a"}' } };
const tool = (id: string): OpenAiTool => ({ type: 'function', function: { [NAME]: id, description: 'tool', parameters: { type: 'object' } } });

const turn = (overrides: Partial<ChatTurnInput> = {}): ChatTurnInput => ({
  modelId: 'gpt-4o',
  messages: [{ role: 'user', content: 'bonjour' }],
  tools: [],
  options: { userId: 'user-1', guildId: 'guild-1', cause: 'reply' },
  ...overrides,
});
const chatRequest = (capability: 'chat.default' | 'chat.reasoning' | 'chat.ingestion', params: Record<string, unknown> = { messages: [{ role: 'user', content: 'bonjour' }] }) => ({
  capability,
  modelId: 'm-1',
  params,
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAiCompatibleAdapter · contrat', () => {
  it('déclare son protocole, ses capacités natives, et rien d\u0027autre', () => {
    expect(adapter.protocol).toBe('openai-chat');
    expect(adapter.capabilities).toEqual(['chat.default', 'chat.reasoning', 'chat.ingestion', 'image.generate', 'image.edit', 'tts.speak']);
    expect(adapter.supports('image.edit', config())).toBe(true);
    expect(adapter.supports('video.generate', config())).toBe(false);
    expect(adapter.supports('custom.truc', config())).toBe(false);
  });
});

describe('testConnection', () => {
  it('GET /models avec la clé Bearer, et compte les modèles', async () => {
    serve({ object: 'list', data: [{ id: 'gpt-4o' }, { id: 'dall-e-3' }, { id: 'tts-1' }] });
    await expect(adapter.testConnection(config())).resolves.toEqual({ ok: true, summary: 'Connecté : 3 modèle(s) disponible(s).', modelsFound: 3 });
    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/models`);
    expect(init.method).toBeUndefined();
    expect(headersOf(init)).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` });
  });

  it('authentification par en-tête dédié, derrière les en-têtes du fournisseur', async () => {
    serve({ data: [] });
    await adapter.testConnection(config({ authType: 'header', authHeaderName: 'X-API-Key', customHeaders: { 'X-Title': 'bot' } }));
    expect(headersOf(lastCall().init)).toEqual({ 'Content-Type': 'application/json', 'X-Title': 'bot', 'X-API-Key': KEY });
  });

  it('authentification par paramètre de requête : la clé voyage dans l\u0027URL, jamais dans un en-tête', async () => {
    serve({ data: [] });
    await adapter.testConnection(config({ authType: 'query', authHeaderName: 'key', baseUrl: `${BASE}/` }));
    expect(lastCall().url).toBe(`${BASE}/models?key=${KEY}`);
    expect(headersOf(lastCall().init)).toEqual({ 'Content-Type': 'application/json' });
  });

  it('échec HTTP : ok false, message de l\u0027erreur typée, zéro modèle, jamais la clé', async () => {
    serve({ error: { message: `Incorrect API key provided: ${KEY}` } }, 401);
    const result = await adapter.testConnection(config());
    expect(result).toEqual({ ok: false, summary: 'HTTP 401 : {"error":{"message":"Incorrect API key provided: [clé masquée]"}}', modelsFound: 0 });
  });

  it('catalogue illisible : ok false avec une erreur unavailable', async () => {
    serve({ models: [] });
    const result = await adapter.testConnection(config());
    expect(result.ok).toBe(false);
    expect(result.modelsFound).toBe(0);
    expect(result.summary).toContain('« data »');
  });
});

describe('discoverModels', () => {
  it.each([
    ['gpt-4o', 'chat'],
    ['dall-e-3', 'image'],
    ['gpt-image-1', 'image'],
    ['stable-diffusion-xl', 'image'],
    ['flux-pro', 'image'],
    ['sd-3', 'image'],
    ['imagen-4', 'image'],
    ['tts-1', 'tts'],
    ['gpt-4o-mini-tts', 'tts'],
    ['whisper-1', 'other'],
    ['text-embedding-3-small', 'other'],
  ])('famille devinée sur l\u0027identifiant : %s donne %s, le nom suit l\u0027identifiant', async (id, kind) => {
    serve({ data: [{ id }] });
    expect(await adapter.discoverModels(config())).toEqual([{ id, [NAME]: id, kind }]);
  });

  it('les entrées sans identifiant sont écartées', async () => {
    serve({ data: [{ object: 'model' }, null, 'texte'] });
    expect(await adapter.discoverModels(config())).toEqual([]);
  });

  it('des sorties déclarées par les métadonnées font foi, et un modèle multimodal garde toutes ses familles', async () => {
    serve({
      data: [
        { id: 'vendor/painter', architecture: { output_modalities: ['text', 'image'] } },
        { id: 'deepseek-flash', architecture: { output_modalities: ['text'] } },
      ],
    });
    expect(await adapter.discoverModels(config())).toEqual([
      { id: 'vendor/painter', [NAME]: 'vendor/painter', kind: 'chat', kinds: ['chat', 'image'] },
      { id: 'deepseek-flash', [NAME]: 'deepseek-flash', kind: 'chat' },
    ]);
  });
});

describe('chat', () => {
  it('POST /chat/completions bloquant, au corps minimal, et analyse la réponse', async () => {
    serve(completion('Salut !'));
    await expect(adapter.chat(config(), turn())).resolves.toEqual({ content: 'Salut !', reasoningContent: null, toolCalls: [], usage: { promptTokens: 12, completionTokens: 34 } });
    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/chat/completions`);
    expect(init.method).toBe('POST');
    expect(bodyOf(init)).toEqual({ model: 'gpt-4o', messages: [{ role: 'user', content: 'bonjour' }] });
    expect(headersOf(init)).toMatchObject({ 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` });
  });

  it('le champ non standard user_id ne part que vers DeepSeek', async () => {
    serve(completion('Salut !'));
    await adapter.chat(config({ baseUrl: 'https://api.deepseek.com' }), turn());
    expect(bodyOf(lastCall().init)).toEqual({ model: 'gpt-4o', messages: [{ role: 'user', content: 'bonjour' }], user_id: 'guild-1' });
  });

  it('encode les tools (points interdits) et pose tool_choice', async () => {
    serve(completion(null, [TOOL_CALL]));
    const result = await adapter.chat(config(), turn({ tools: [tool('records.create')], options: { userId: 'user-1', guildId: null, cause: 'reply', toolChoice: 'none' } }));
    expect(bodyOf(lastCall().init)).toMatchObject({ tools: [{ function: { [NAME]: 'records__create' } }], tool_choice: 'none' });
    expect(result.toolCalls).toEqual([{ id: 'call_1', [NAME]: 'records.create', arguments: '{"note":"a"}' }]);
    expect(result.content).toBeNull();
  });

  it.each([
    ['https://api.example.test/v1', 'low', false],
    ['https://api.deepseek.com', 'low', true],
    ['https://api.deepseek.com/v1/', null, false],
    ['https://api.deepseek.com.example.test/v1', 'low', false],
  ])('reasoning_effort chez %s (effort %s) : envoyé = %s', async (baseUrl, reasoningEffort, sent) => {
    serve(completion('ok'));
    const options = { userId: 'user-1', guildId: 'guild-1', cause: 'reply', reasoningEffort } as ChatTurnInput['options'];
    await adapter.chat(config({ baseUrl }), turn({ options }));
    const body = bodyOf(lastCall().init);
    expect('reasoning_effort' in body).toBe(sent);
    if (sent) expect(body.reasoning_effort).toBe('low');
    expect(lastCall().url).toBe(`${baseUrl.replace(/\/+$/u, '')}/chat/completions`);
  });

  it('onDelta reçoit le texte une fois sans tool_call, jamais avec', async () => {
    const onDelta = vi.fn();
    serve(completion('Salut !'));
    await adapter.chat(config(), turn({ onDelta }));
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith('Salut !');
    serve(completion(null, [TOOL_CALL]));
    const silent = vi.fn();
    await adapter.chat(config(), turn({ onDelta: silent }));
    expect(silent).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'auth'],
    [402, 'quota'],
    [429, 'rate-limit'],
    [500, 'unavailable'],
    [404, 'http'],
  ])('HTTP %i : erreur typée %s, sans la clé', async (status, kind) => {
    serve({ error: { message: `clé refusée : ${KEY}` } }, status);
    const error = await failure(() => adapter.chat(config(), turn()));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.message).toContain('[clé masquée]');
  });

  it('panne réseau : erreur unavailable au message fixe, même quand la clé voyage dans l\u0027URL', async () => {
    fetchMock.mockRejectedValue(new Error(`connect ECONNREFUSED ${BASE}/chat/completions?key=${KEY}`));
    const error = await failure(() => adapter.chat(config({ authType: 'query', authHeaderName: 'key' }), turn()));
    expect(error.kind).toBe('unavailable');
  });

  it('délai dépassé : erreur timeout', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { [NAME]: 'TimeoutError' }));
    const error = await failure(() => adapter.chat(config(), turn()));
    expect(error.kind).toBe('timeout');
  });

  it('un 200 sans choix est une panne du fournisseur (unavailable), pas une réponse vide', async () => {
    serve({ error: { message: 'internal' } });
    const error = await failure(() => adapter.chat(config(), turn()));
    expect(error.kind).toBe('unavailable');
  });

  it('une fuite de balises internes dans le texte refuse le tour', async () => {
    serve(completion('<｜DSML｜function_calls>game'));
    await expect(adapter.chat(config(), turn())).rejects.toBeInstanceOf(LlmFormatLeakError);
  });
});

describe('execute · chat.*', () => {
  it('mêmes appels, data = contenu, tool_calls et usage', async () => {
    serve(completion('Voici.'));
    const result = await adapter.execute(config(), chatRequest('chat.ingestion', { messages: [{ role: 'user', content: 'résume' }], userId: 'user-9', guildId: 'guild-2' }));
    expect(lastCall().url).toBe(`${BASE}/chat/completions`);
    expect(bodyOf(lastCall().init)).toEqual({ model: 'm-1', messages: [{ role: 'user', content: 'résume' }] });
    expect(result).toEqual({ ok: true, summary: 'Réponse reçue (6 caractères).', data: { content: 'Voici.', toolCalls: [], usage: { promptTokens: 12, completionTokens: 34 } } });
  });

  it('hors DeepSeek, aucun champ user_id ; avec tools : le résumé compte les appels', async () => {
    serve(completion(null, [TOOL_CALL]));
    const result = await adapter.execute(config(), chatRequest('chat.reasoning', { messages: [{ role: 'user', content: 'go' }], tools: [tool('records.create')] }));
    expect(bodyOf(lastCall().init)).toMatchObject({ tool_choice: 'auto' });
    expect(bodyOf(lastCall().init)).not.toHaveProperty('user_id');
    expect(result.summary).toBe('1 appel(s) d\u0027outil demandé(s).');
  });

  it('messages manquants : erreur invalid avant tout appel', async () => {
    const error = await failure(() => adapter.execute(config(), chatRequest('chat.default', {})));
    expect(error.kind).toBe('invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('une capacité que le protocole ne sert pas : erreur unsupported, sans appel', async () => {
    const error = await failure(() => adapter.execute(config(), { capability: 'video.generate', modelId: 'm-1', params: {} }));
    expect(error.kind).toBe('unsupported');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('une clé recopiée par le fournisseur dans une réponse réussie ne ressort pas', async () => {
    serve(completion(`voici la clé ${KEY}`));
    const result = await adapter.execute(config(), chatRequest('chat.default'));
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(await adapter.chat(config(), turn()))).not.toContain(KEY);
  });
});
