import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookRequestPlan } from './webhook-request.builder';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));

const { sendWebhookRequest, describeExchangeFailure } = await import('./webhook-http');
const { WEBHOOK_BODY_MAX_BYTES, WEBHOOK_TIMEOUT_MS } = await import('./webhook-request.builder');

/**
 * Échange HTTP d'un connecteur. Ce que ces tests fixent : la requête passe
 * par la garde des requêtes sortantes (un nom public qui résout en interne
 * n'est jamais appelé, chaque saut de redirection est validé), les
 * identifiants ne suivent pas une redirection vers une autre origine, la
 * réponse est plafonnée, et un échec se dit sans jamais montrer un en-tête.
 */

// Valeur factice d'un en-tête secret, sans valeur utilisable.
const KEY = 'test-key-not-real';
const PUBLIC = 'https://api.example.test';

const plan = (overrides: Partial<WebhookRequestPlan> = {}): WebhookRequestPlan => ({
  url: `${PUBLIC}/hooks/orders`,
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'X-Api-Key': KEY },
  body: '{"ping":true}',
  extractPath: 'data.result',
  ...overrides,
});

const initOf = (call: unknown[] | undefined): RequestInit => (call?.[1] ?? {}) as RequestInit;

/** Remplace `fetch` par une suite d'issues, dans l'ordre des appels : une réponse, ou une erreur jetée. */
function stubFetch(...outcomes: Array<Response | Error>): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchMock = vi.fn<typeof fetch>();
  for (const outcome of outcomes) {
    if (outcome instanceof Error) fetchMock.mockRejectedValueOnce(outcome);
    else fetchMock.mockResolvedValueOnce(outcome);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const redirect = (location: string, status = 302): Response => new Response(null, { status, headers: { location } });
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Flux fini ; `cancel` note l'interruption. */
function finished(cancel: (reason?: unknown) => void = () => undefined): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
      controller.close();
    },
    cancel,
  });
}

/** Flux sans fin (un morceau de `size` octets à chaque tirage) ; `cancel` note l'interruption. */
function endless(size: number, cancel: (reason?: unknown) => void = () => undefined): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(size));
    },
    cancel,
  });
}

beforeEach(() => {
  dns.lookup.mockResolvedValue([{ address: '104.18.1.2' }]);
});

afterEach(() => {
  dns.lookup.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendWebhookRequest', () => {
  it('envoie la requête montée, à travers la garde, avec le délai du connecteur', async () => {
    const fetchMock = stubFetch(jsonResponse({ data: { result: 'ok' } }));
    const deadline = vi.spyOn(AbortSignal, 'timeout');
    const result = await sendWebhookRequest(plan());
    expect(result).toMatchObject({ ok: true, status: 200, body: '{"data":{"result":"ok"}}', unfollowedRedirect: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = initOf(fetchMock.mock.calls[0]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${PUBLIC}/hooks/orders`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual(plan().headers);
    expect(init.body).toBe('{"ping":true}');
    expect(init.redirect).toBe('manual');
    const allowed = deadline.mock.calls[0]?.[0] ?? 0;
    expect(allowed).toBeLessThanOrEqual(WEBHOOK_TIMEOUT_MS);
    expect(allowed).toBeGreaterThan(WEBHOOK_TIMEOUT_MS - 5_000);
  });

  it('sans chemin d\u0027extraction, le corps n\u0027est pas lu et la connexion est libérée', async () => {
    const cancel = vi.fn();
    stubFetch(new Response(finished(cancel), { headers: { 'content-length': '4' } }));
    const result = await sendWebhookRequest(plan({ extractPath: null }));
    expect(result).toMatchObject({ ok: true, status: 200, body: '' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('GET sans corps ; un statut d\u0027erreur est une réponse, pas un échec', async () => {
    const fetchMock = stubFetch(new Response('Service indisponible', { status: 503 }));
    const result = await sendWebhookRequest(plan({ method: 'GET', body: null }));
    expect(result).toMatchObject({ ok: true, status: 503, body: 'Service indisponible' });
    expect(initOf(fetchMock.mock.calls[0]).body).toBeUndefined();
  });
});

describe('redirections', () => {
  it('même origine : suivie, chaque saut validé, la requête rejouée à l\u0027identique sur un 307', async () => {
    const fetchMock = stubFetch(redirect('/v2/hooks/orders', 307), jsonResponse({ ok: 1 }));
    const result = await sendWebhookRequest(plan());
    expect(result).toMatchObject({ ok: true, status: 200, unfollowedRedirect: false });
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([`${PUBLIC}/hooks/orders`, `${PUBLIC}/v2/hooks/orders`]);
    const replayed = initOf(fetchMock.mock.calls[1]);
    expect(replayed.method).toBe('POST');
    expect(replayed.body).toBe('{"ping":true}');
    expect(replayed.headers).toEqual(plan().headers);
    expect(dns.lookup).toHaveBeenCalledTimes(2);
  });

  it('même origine, un 302 sur un POST repart en GET sans corps ni type de contenu', async () => {
    const fetchMock = stubFetch(redirect('/done'), jsonResponse({ ok: 1 }));
    await sendWebhookRequest(plan());
    const replayed = initOf(fetchMock.mock.calls[1]);
    expect(replayed.method).toBe('GET');
    expect(replayed.body).toBeUndefined();
    expect(new Headers(replayed.headers).has('content-type')).toBe(false);
    expect(new Headers(replayed.headers).get('x-api-key')).toBe(KEY);
  });

  it('vers une autre origine : NON suivie, les identifiants ne partent pas', async () => {
    const fetchMock = stubFetch(redirect('https://autre-origine.example.net/collect'));
    const result = await sendWebhookRequest(plan());
    expect(result).toMatchObject({ ok: true, status: 302, body: '', unfollowedRedirect: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('vers une adresse interne : jamais suivie, la requête vers l\u0027adresse interne ne part pas', async () => {
    const fetchMock = stubFetch(redirect('https://127.0.0.1/latest/meta-data'));
    const result = await sendWebhookRequest(plan());
    expect(result).toMatchObject({ ok: true, status: 302, unfollowedRedirect: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${PUBLIC}/hooks/orders`);
  });

  it('vers un nom public qui résout en interne : jamais suivie, le nom n\u0027est même pas résolu', async () => {
    dns.lookup.mockImplementation(async (host: string) => [{ address: host === 'interne.example.test' ? '10.0.0.5' : '104.18.1.2' }]);
    const fetchMock = stubFetch(redirect('https://interne.example.test/secret'));
    const result = await sendWebhookRequest(plan());
    expect(result).toMatchObject({ ok: true, status: 302, unfollowedRedirect: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dns.lookup.mock.calls.some((call) => String(call[0]) === 'interne.example.test')).toBe(false);
  });

  it('même origine, mais le nom résout en interne au saut suivant : refusé par la garde', async () => {
    dns.lookup.mockResolvedValueOnce([{ address: '104.18.1.2' }]).mockResolvedValueOnce([{ address: '10.0.0.5' }]);
    const fetchMock = stubFetch(redirect('/v2/hooks/orders'), jsonResponse({ ok: 1 }));
    const result = await sendWebhookRequest(plan());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.summary).toContain('Blocked host');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('vers http, ou vers une adresse illisible : non suivie', async () => {
    stubFetch(redirect('http://insecure.example.net/x'));
    expect(await sendWebhookRequest(plan())).toMatchObject({ ok: true, status: 302, unfollowedRedirect: true });
    vi.stubGlobal('fetch', vi.fn(async () => redirect('https://[illisible')));
    expect(await sendWebhookRequest(plan())).toMatchObject({ ok: true, status: 302, unfollowedRedirect: true });
  });

  it('plus de cinq sauts : la dernière redirection est rendue', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => redirect('/encore'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendWebhookRequest(plan());
    expect(result).toMatchObject({ ok: true, status: 302, unfollowedRedirect: false });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('le délai couvre tout l\u0027échange : plus de temps entre deux sauts, l\u0027échange échoue', async () => {
    stubFetch(redirect('/again'));
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_000).mockReturnValueOnce(1_000 + WEBHOOK_TIMEOUT_MS + 1);
    const result = await sendWebhookRequest(plan());
    expect(result).toMatchObject({ ok: false, summary: expect.stringContaining('délai') });
  });
});

describe('hôtes refusés', () => {
  it('un nom public qui résout vers une adresse privée n\u0027est jamais appelé', async () => {
    dns.lookup.mockResolvedValue([{ address: '192.168.1.10' }]);
    const fetchMock = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendWebhookRequest(plan());
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.summary).toContain('Blocked host');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('lecture plafonnée', () => {
  it('une longueur déclarée au-dessus du plafond est refusée sans lire le corps', async () => {
    const cancel = vi.fn();
    stubFetch(new Response(finished(cancel), { headers: { 'content-length': '999999' } }));
    const result = await sendWebhookRequest(plan());
    expect(result).toMatchObject({ ok: false, summary: expect.stringContaining('plafond : 256 Ko') });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('un flux qui dépasse le plafond est coupé dès le dépassement', async () => {
    const cancel = vi.fn();
    stubFetch(new Response(endless(64 * 1024, cancel)));
    const result = await sendWebhookRequest(plan());
    expect(result).toMatchObject({ ok: false, summary: expect.stringContaining('plafond') });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('un corps exactement à la limite passe', async () => {
    stubFetch(new Response('A'.repeat(WEBHOOK_BODY_MAX_BYTES)));
    const result = await sendWebhookRequest(plan());
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(result.ok ? result.body.length : 0).toBe(WEBHOOK_BODY_MAX_BYTES);
  });
});

describe('échecs', () => {
  it('délai, réseau, refus de la garde : chacun se dit, sans jamais montrer un en-tête', async () => {
    const aborted = new Error('The operation was aborted due to timeout');
    aborted.name = 'TimeoutError';
    stubFetch(aborted);
    const timeout = await sendWebhookRequest(plan());
    expect(timeout).toMatchObject({ ok: false, summary: expect.stringContaining('délai') });

    stubFetch(new TypeError('fetch failed'));
    const network = await sendWebhookRequest(plan());
    expect(network).toMatchObject({ ok: false, summary: 'Requête impossible : réseau ou hôte injoignable.' });

    for (const result of [timeout, network]) expect(JSON.stringify(result)).not.toContain(KEY);
    expect(describeExchangeFailure(new Error('Blocked host: api.example.test (résout vers une adresse locale, privée ou réservée)'))).toContain('Blocked host');
    expect(describeExchangeFailure('autre chose')).toBe('Requête impossible.');
  });
});
