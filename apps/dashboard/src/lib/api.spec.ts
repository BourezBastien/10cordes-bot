import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { jsonResponse } from '@/test/render';

/*
 * Le client API est testé par son module, importé dynamiquement pour
 * remplacer `fetch` avant toute requête. `fetch` est remplacée par une
 * fonction typée : les appels se lisent (chemin, corps, en-têtes).
 */

type FetchCall = [input: RequestInfo | URL, init?: RequestInit];

const OK = z.object({ ok: z.boolean() });

function stubFetch(respond: (init: RequestInit | undefined) => Response | Promise<Response>) {
  const fetchMock = vi.fn<(...args: FetchCall) => Promise<Response>>(async (_input, init) => respond(init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('client API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function client() {
    return import('@/lib/api');
  }

  it('n\u0027envoie aucun Content-Type sans corps, et toujours les cookies', async () => {
    const { api } = await client();
    const fetchMock = stubFetch(() => jsonResponse({ ok: true }));
    await api.post('/api/x', undefined, OK);
    const [path, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(path).toBe('/api/x');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
    expect(init?.credentials).toBe('include');
  });

  it('envoie du JSON avec son Content-Type quand il y a un corps', async () => {
    const { api } = await client();
    const fetchMock = stubFetch(() => jsonResponse({ ok: true }));
    await api.patch('/api/x', { name: 'Test' }, OK);
    const [, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(init?.method).toBe('PATCH');
    expect(init?.body).toBe(JSON.stringify({ name: 'Test' }));
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });

  it('une réponse 401 renvoie à la page de connexion et lève une ApiError', async () => {
    const { api, ApiError, onUnauthorized } = await client();
    stubFetch(() => jsonResponse({ ok: false, error: 'Unauthorized' }, 401));
    const redirect = vi.fn();
    const previous = onUnauthorized.redirect;
    onUnauthorized.redirect = redirect;
    try {
      await expect(api.get('/api/v1/guilds', OK)).rejects.toBeInstanceOf(ApiError);
      expect(redirect).toHaveBeenCalledTimes(1);
    } finally {
      onUnauthorized.redirect = previous;
    }
  });

  it('lit l\u0027enveloppe d\u0027erreur avec ses champs en cause', async () => {
    const { api, ApiError, errorMessage } = await client();
    stubFetch(() => jsonResponse({ ok: false, error: 'Validation failed', details: [{ property: 'baseUrl', constraints: { message: 'https attendu' } }] }, 400));
    const error = await api.post('/api/x', {}, OK).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as InstanceType<typeof ApiError>;
    expect(apiError.status).toBe(400);
    expect(apiError.details[0]?.property).toBe('baseUrl');
    expect(errorMessage(error)).toBe('https attendu');
  });

  it('refuse une réponse qui ne ressemble pas au contrat', async () => {
    const { api, ShapeError, errorMessage } = await client();
    stubFetch(() => jsonResponse({ providers: 'pas-une-liste' }));
    const error = await api.get('/api/v1/guilds/1/providers', z.object({ providers: z.array(z.string()) })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ShapeError);
    expect(errorMessage(error)).toContain('Réponse inattendue');
  });

  it('un serveur injoignable devient une ApiError de statut 0', async () => {
    const { api, ApiError } = await client();
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    const error = await api.get('/api/x', OK).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).status).toBe(0);
  });

  it('accepte un 204 sans corps', async () => {
    const { api, NO_CONTENT } = await client();
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(api.delete('/api/x/1', NO_CONTENT)).resolves.toBeUndefined();
  });

  it('ne répète jamais le corps d\u0027une erreur qui n\u0027est pas du JSON', async () => {
    const { api, ApiError } = await client();
    stubFetch(() => new Response('<html>pane</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    const error = await api.get('/api/x', OK).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).message).toBe('HTTP 502');
    expect((error as InstanceType<typeof ApiError>).message).not.toContain('html');
  });
});
