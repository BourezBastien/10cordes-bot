import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError, type ChatTurnInput, type ProviderConfig, type ProviderRequest } from '../provider.types';
import { GenericHttpAdapter } from './generic-http.adapter';

// Clés calculées : sync-tool-names.mjs repère une clé `name` (aussi en fin de `displayName`) suivie d'une chaîne.
const NAME = 'name';
const DISPLAY_NAME = 'displayName';
const KEY = 'test-key-not-real';
const BASE = 'https://api.example.test/v1';

/**
 * API quelconque branchée sans code : opérations saisies dans `extraConfig`,
 * rendu des gabarits, lecture de la réponse. Le `fetch` global est remplacé :
 * la garde du socle (https, hôte public) et l'authentification restent réelles.
 */

const fetchMock = vi.fn<typeof fetch>();
const adapter = new GenericHttpAdapter();

/** Ce qu'un administrateur saisit (forme brute, non typée). */
const EXTRA: Record<string, unknown> = {
  operations: {
    'image.generate': {
      method: 'POST',
      path: '/v2/create-image',
      headers: { 'X-Title': '{{title}}' },
      query: { lang: '{{lang}}', page: '2' },
      body: { model: '{{modelId}}', prompt: '{{prompt}}', count: '{{count}}', ratio: '16:9', seed: '{{seed}}', mask: '{{mask}}', options: { style: '{{style}}', raw: true } },
      responsePath: 'data.resultUrls.0',
    },
    translate: { method: 'post', path: '/translate/{{target}}', body: { q: 'Traduis : {{text}}' }, responsePath: 'result.text' },
    'custom.summarize': { method: 'POST', path: '/summarize', body: { text: '{{text}}', model: '{{modelId}}' } },
  },
  models: [{ id: 'flux-pro', [NAME]: 'Flux Pro', kind: 'Image' }, { id: 'voice-x', kind: 'tts' }, { id: 'raw-model' }, { id: 42 }, { kind: 'chat' }],
  test: { method: 'GET', path: '/v2/me' },
};
const FULL = { prompt: 'un chat', count: 2, seed: 0, mask: null, style: 'photo', title: 'bot', lang: 'fr' };
const TURN: ChatTurnInput = { modelId: 'raw-model', messages: [], tools: [], options: { userId: 'user-1', guildId: null, cause: 'reply' } };

function config(overrides: Partial<ProviderConfig> = {}, extraConfig: Record<string, unknown> = EXTRA): ProviderConfig {
  return {
    id: 'provider-1',
    guildId: 'guild-1',
    slug: 'custom',
    [DISPLAY_NAME]: 'Custom',
    protocol: 'generic-http',
    baseUrl: BASE,
    authType: 'bearer',
    authHeaderName: null,
    apiKey: KEY,
    customHeaders: {},
    extraConfig,
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

const request = (capability: string, params: Record<string, unknown>, modelId = 'flux-pro'): ReturnType<GenericHttpAdapter['execute']> =>
  adapter.execute(config(), { capability: capability as ProviderRequest['capability'], modelId, params });

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('aucun appel fetch');
  return { url: String(call[0]), init: call[1] ?? {} };
}
const bodyOf = (init: RequestInit): Record<string, unknown> => JSON.parse(String(init.body)) as Record<string, unknown>;
const headersOf = (init: RequestInit): Record<string, string> => init.headers as Record<string, string>;

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

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GenericHttpAdapter · capacités déclarées', () => {
  it('ne sert rien d\u0027office, puis ce que les opérations décrivent (native ou custom.*)', () => {
    expect(adapter.protocol).toBe('generic-http');
    expect(adapter.capabilities).toEqual([]);
    expect(adapter.supports('image.generate', config({}, {}))).toBe(false);
    expect(adapter.supports('image.generate', config())).toBe(true);
    expect(adapter.supports('custom.translate', config())).toBe(true);
    expect(adapter.supports('custom.summarize', config())).toBe(true);
    expect(adapter.supports('custom.music', config())).toBe(false);
    expect(adapter.supports('custom.constructor', config())).toBe(false);
  });

  it('ne prétend jamais servir un tour de conversation, même décrit par une opération', async () => {
    const withChat = config({}, { operations: { 'chat.default': { method: 'POST', path: '/chat', body: {} } } });
    expect(adapter.supports('chat.default', withChat)).toBe(false);
    expect((await failure(() => adapter.chat(withChat, TURN))).kind).toBe('unsupported');
  });
});

describe('execute', () => {
  it('rend les gabarits (chemin, requête, en-têtes, corps typé) et lit la réponse au chemin pointé', async () => {
    serve({ code: 0, data: { resultUrls: ['https://cdn.example.test/a.png', 'https://cdn.example.test/b.png'] } });
    const result = await request('image.generate', FULL);
    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/v2/create-image?lang=fr&page=2`);
    expect(init.method).toBe('POST');
    expect(headersOf(init)).toEqual({ 'Content-Type': 'application/json', 'X-Title': 'bot', Authorization: `Bearer ${KEY}` });
    expect(bodyOf(init)).toEqual({
      model: 'flux-pro',
      prompt: 'un chat',
      count: 2,
      ratio: '16:9',
      seed: 0,
      mask: null,
      options: { style: 'photo', raw: true },
    });
    expect(result).toEqual({ ok: true, summary: 'POST /v2/create-image : HTTP 200', data: { 0: 'https://cdn.example.test/a.png', status: 200 } });
  });

  it('gabarit mêlé → String(valeur) ; méthode insensible à la casse ; chemin paramétré', async () => {
    serve({ result: { text: 'Hello' } });
    const result = await request('custom.translate', { target: 'en', text: ['a', 'b'] });
    expect(lastCall().url).toBe(`${BASE}/translate/en`);
    expect(lastCall().init.method).toBe('POST');
    expect(bodyOf(lastCall().init)).toEqual({ q: 'Traduis : a,b' });
    expect(result).toEqual({ ok: true, summary: 'POST /translate/{{target}} : HTTP 200', data: { text: 'Hello', status: 200 } });
  });

  it('{{modelId}} rend le modèle de la route ; un paramètre explicite du même nom le remplace', async () => {
    serve({});
    await request('custom.summarize', { text: 'x' });
    expect(bodyOf(lastCall().init)).toEqual({ text: 'x', model: 'flux-pro' });
    await request('custom.summarize', { text: 'x', modelId: 'autre' });
    expect(bodyOf(lastCall().init)).toEqual({ text: 'x', model: 'autre' });
  });

  it('sans responsePath : le corps JSON entier sous result ; { text } s\u0027il n\u0027est pas du JSON', async () => {
    serve({ ok: true, count: 2 });
    await expect(request('custom.summarize', { text: 'x' })).resolves.toMatchObject({ data: { result: { ok: true, count: 2 }, status: 200 } });
    serve('fait', 201, { 'content-type': 'text/plain' });
    await expect(request('custom.summarize', { text: 'x' })).resolves.toMatchObject({
      summary: 'POST /summarize : HTTP 201',
      data: { result: { text: 'fait' }, status: 201 },
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(request('custom.summarize', { text: 'x' })).resolves.toMatchObject({ data: { result: { text: '' }, status: 204 } });
  });

  it('clé en paramètre de requête : posée par le socle après ceux de l\u0027opération', async () => {
    serve({ data: { resultUrls: ['u'] } });
    await adapter.execute(config({ authType: 'query', authHeaderName: 'key' }), { capability: 'image.generate', modelId: 'flux-pro', params: FULL });
    expect(lastCall().url).toBe(`${BASE}/v2/create-image?lang=fr&page=2&key=${KEY}`);
    expect(headersOf(lastCall().init)).toEqual({ 'Content-Type': 'application/json', 'X-Title': 'bot' });
  });

  it('paramètre manquant : erreur invalid nommée, avant tout appel', async () => {
    expect(await failure(() => request('custom.summarize', {}))).toMatchObject({ kind: 'invalid', message: 'Paramètre manquant : text' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un paramètre ne peut ni injecter une query, ni un fragment, ni remonter un dossier', async () => {
    for (const target of ['fr?admin=1', 'fr#x', '../secret', 'a/../../b', 'a\\b']) {
      expect((await failure(() => request('custom.translate', { target, text: 'x' }))).kind).toBe('invalid');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('capacité sans opération : unsupported ; opération mal formée : invalid, avec le champ à corriger', async () => {
    expect((await failure(() => request('custom.music', {}))).kind).toBe('unsupported');
    const broken = config({}, {
      operations: { 'custom.music': { method: 'FETCH', path: '/m' }, 'custom.void': { method: 'GET' }, 'custom.text': 'pas une opération' },
    });
    const first = await failure(() => adapter.execute(broken, { capability: 'custom.music', modelId: 'm', params: {} }));
    expect(first).toMatchObject({ kind: 'invalid', message: expect.stringContaining('method') });
    expect((await failure(() => adapter.execute(broken, { capability: 'custom.void', modelId: 'm', params: {} }))).message).toContain('path');
    expect(await failure(() => adapter.execute(broken, { capability: 'custom.text', modelId: 'm', params: {} }))).toMatchObject({ kind: 'invalid', message: expect.stringContaining('mal formée') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('chemin de réponse introuvable : erreur http avec un extrait du corps, masqué', async () => {
    serve({ code: 402, message: `solde épuisé pour ${KEY}` });
    const error = await failure(() => request('image.generate', FULL));
    expect(error).toMatchObject({ kind: 'http', status: 200 });
    expect(error.message).toContain('« data.resultUrls.0 » introuvable');
    expect(error.message).toContain('solde épuisé pour [clé masquée]');
  });

  it.each([
    [401, 'auth'],
    [429, 'rate-limit'],
    [500, 'unavailable'],
  ])('HTTP %i : erreur typée %s, sans la clé', async (status, kind) => {
    serve({ error: `clé refusée : ${KEY}` }, status);
    const error = await failure(() => request('custom.summarize', { text: 'x' }));
    expect(error).toMatchObject({ kind, status });
    expect(error.message).toContain('[clé masquée]');
  });

  it('une clé renvoyée par l\u0027API dans une réponse réussie ne ressort jamais', async () => {
    serve({ headers: { Authorization: `Bearer ${KEY}` }, [KEY]: KEY });
    const result = await request('custom.summarize', { text: 'x' });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});

describe('testConnection', () => {
  it('exécute le contrôle déclaré : succès sur un 2xx, résumé avec les modèles saisis', async () => {
    serve({ plan: 'pro' });
    await expect(adapter.testConnection(config())).resolves.toEqual({ ok: true, summary: 'Connecté : 3 modèle(s) saisi(s).', modelsFound: 3 });
    expect(lastCall().url).toBe(`${BASE}/v2/me`);
    expect(lastCall().init.method).toBe('GET');
    expect(headersOf(lastCall().init)).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` });
  });

  it('contrôle en échec HTTP : ok false, message de l\u0027erreur typée, zéro modèle, sans la clé', async () => {
    serve({ error: `bad key ${KEY}` }, 401);
    await expect(adapter.testConnection(config())).resolves.toEqual({ ok: false, summary: 'HTTP 401 : {"error":"bad key [clé masquée]"}', modelsFound: 0 });
  });

  it('sans contrôle déclaré : ok true, résumé dédié et nombre de modèles saisis, sans appel', async () => {
    await expect(adapter.testConnection(config({}, { models: EXTRA.models }))).resolves.toEqual({
      ok: true,
      summary: 'Aucun contrôle défini pour ce fournisseur (opérations sur mesure).',
      modelsFound: 3,
    });
    await expect(adapter.testConnection(config({}, {}))).resolves.toMatchObject({ ok: true, modelsFound: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('contrôle mal formé : ok false, avec le champ à corriger, sans appel', async () => {
    const result = await adapter.testConnection(config({}, { test: { method: 'GET' } }));
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('path');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('discoverModels', () => {
  it('rend les modèles saisis : famille normalisée, nom replié sur l\u0027identifiant, entrées invalides écartées', async () => {
    await expect(adapter.discoverModels(config())).resolves.toEqual([
      { id: 'flux-pro', [NAME]: 'Flux Pro', kind: 'image' },
      { id: 'voice-x', [NAME]: 'voice-x', kind: 'tts' },
      { id: 'raw-model', [NAME]: 'raw-model' },
    ]);
    await expect(adapter.discoverModels(config({}, {}))).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
