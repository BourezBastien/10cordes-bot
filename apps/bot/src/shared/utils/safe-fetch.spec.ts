import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));

const { OversizedResponseError, assertPublicHost, assertSafeUrl, safeFetch, safeFetchBytes, safeFetchJson, safeFetchText } = await import('./safe-fetch');

/**
 * Garde des requêtes sortantes. Un nom public qui résout vers une adresse
 * interne est la façon la plus courante d'atteindre le réseau du serveur :
 * la forme de l'hôte ne suffit pas, son adresse résolue décide aussi. Une
 * redirection est un second chemin vers ce réseau : chaque saut est validé.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const PUBLIC = 'https://api.example.test';

const initOf = (call: unknown[] | undefined): RequestInit => (call?.[1] ?? {}) as RequestInit;

/** Remplace `fetch` par une suite de réponses, dans l'ordre des appels. */
function stubFetch(...responses: Response[]): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const redirect = (location: string, status = 302, body?: string | null): Response => new Response(body, { status, headers: { location } });

/** Flux fini (les morceaux donnés, puis fermeture) ; `cancel` note l'interruption. */
function stream(sizes: number[], cancel = vi.fn()): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of sizes) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
    cancel,
  });
}

/** Flux sans fin (un morceau de `size` octets à chaque tirage), comme un corps encore en train d\u0027arriver ; `cancel` note l\u0027interruption. */
function endless(size: number, cancel = vi.fn()): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(size));
    },
    cancel,
  });
}

afterEach(() => {
  dns.lookup.mockReset();
  vi.unstubAllGlobals();
});

describe('assertSafeUrl', () => {
  it('https uniquement', () => {
    expect(() => assertSafeUrl('http://api.example.test/v1')).toThrow('Only https URLs are allowed');
    expect(() => assertSafeUrl('ftp://api.example.test')).toThrow('Only https URLs are allowed');
    expect(assertSafeUrl('https://api.example.test/v1').hostname).toBe('api.example.test');
  });

  it.each(['localhost', '127.0.0.1', '10.0.0.1', '192.168.1.1', 'printer.local', 'db.internal', '[::1]'])('%s : refusé sur sa forme', (host) => {
    expect(() => assertSafeUrl(`https://${host}/x`)).toThrow('Blocked host');
  });
});

describe('assertPublicHost', () => {
  it('un nom qui résout vers une adresse interne est refusé, même public d\u0027apparence', async () => {
    dns.lookup.mockResolvedValue([{ address: '2606:4700::6810:84e5' }, { address: '10.0.0.5' }]);
    await expect(assertPublicHost('api.example.test')).rejects.toThrow('Blocked host');
    expect(dns.lookup).toHaveBeenCalledWith('api.example.test', { all: true, verbatim: true });
  });

  it('un nom qui ne résout que vers des adresses publiques passe', async () => {
    dns.lookup.mockResolvedValue([{ address: '104.18.1.2' }, { address: '2606:4700::6810:84e5' }]);
    await expect(assertPublicHost('api.example.test')).resolves.toBeUndefined();
  });

  it('un nom inconnu n\u0027est pas arrêté ici : la requête échouera d\u0027elle-même', async () => {
    dns.lookup.mockRejectedValue(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
    await expect(assertPublicHost('nexistepas.example.test')).resolves.toBeUndefined();
  });

  it.each(['127.0.0.1', '10.1.2.3', '192.168.0.1', '169.254.1.1', '192.0.2.1', '[::1]', 'fe80::1', '::ffff:127.0.0.1'])('%s : littérale privée ou réservée, refusée sans résolution', async (host) => {
    await expect(assertPublicHost(host)).rejects.toThrow('Blocked address');
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('une littérale publique passe sans résolution', async () => {
    await expect(assertPublicHost('8.8.8.8')).resolves.toBeUndefined();
    expect(dns.lookup).not.toHaveBeenCalled();
  });
});

describe('safeFetch', () => {
  it('un hôte qui résout vers une adresse privée n\u0027est jamais appelé', async () => {
    dns.lookup.mockResolvedValue([{ address: '192.168.1.10' }]);
    const fetchMock = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetch(`${PUBLIC}/v1/models`)).rejects.toThrow('Blocked host');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un hôte public est appelé, avec l\u0027URL validée', async () => {
    dns.lookup.mockResolvedValue([{ address: '104.18.1.2' }]);
    const fetchMock = stubFetch(new Response('ok'));
    const response = await safeFetch(`${PUBLIC}/v1/models`);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${PUBLIC}/v1/models`);
  });

  it('le délai par défaut est de 30 s ; à null, seul le signal de l\u0027appelant décide', async () => {
    dns.lookup.mockResolvedValue([{ address: '104.18.1.2' }]);
    const fetchMock = stubFetch(new Response('ok'), new Response('ok'));
    const deadline = vi.spyOn(AbortSignal, 'timeout');
    await safeFetch(`${PUBLIC}/a`);
    expect(deadline).toHaveBeenCalledWith(30_000);
    await safeFetch(`${PUBLIC}/b`, { timeoutMs: null, signal: new AbortController().signal });
    expect(deadline).toHaveBeenCalledTimes(1);
    expect(initOf(fetchMock.mock.calls[1]).signal).toBeInstanceOf(AbortSignal);
    deadline.mockRestore();
  });
});

describe('safeFetch · redirections', () => {
  beforeEach(() => {
    dns.lookup.mockResolvedValue([{ address: '104.18.1.2' }]);
  });

  it('une redirection du même site est suivie : chaque saut validé, jamais laissé au runtime', async () => {
    const fetchMock = stubFetch(redirect('/v2/models'), new Response('ok'));
    const response = await safeFetch(`${PUBLIC}/v1/models`);
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([`${PUBLIC}/v1/models`, `${PUBLIC}/v2/models`]);
    expect(dns.lookup).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) expect(initOf(call).redirect).toBe('manual');
  });

  it('vers une autre origine, les identifiants ne suivent pas', async () => {
    const fetchMock = stubFetch(redirect('https://cdn.example.net/file.json'), new Response('{}'));
    await safeFetch(`${PUBLIC}/file`, { headers: { Authorization: `Bearer ${KEY}`, Cookie: 'session=1', Accept: 'application/json' } });
    const forwarded = new Headers(initOf(fetchMock.mock.calls[1]).headers);
    expect(forwarded.has('authorization')).toBe(false);
    expect(forwarded.has('cookie')).toBe(false);
    expect(forwarded.get('accept')).toBe('application/json');
  });

  it('vers la même origine, les en-têtes suivent', async () => {
    const fetchMock = stubFetch(redirect('/v2/file'), new Response('{}'));
    await safeFetch(`${PUBLIC}/file`, { headers: { Authorization: `Bearer ${KEY}` } });
    expect(new Headers(initOf(fetchMock.mock.calls[1]).headers).get('authorization')).toBe(`Bearer ${KEY}`);
  });

  it('une redirection vers une adresse interne est refusée : un seul appel', async () => {
    const fetchMock = stubFetch(redirect('https://127.0.0.1/latest/meta-data'));
    await expect(safeFetch(`${PUBLIC}/feed`)).rejects.toThrow('Blocked host: 127.0.0.1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('une redirection vers un nom public qui résout en interne est refusée', async () => {
    dns.lookup.mockImplementation(async (host: string) => [{ address: host === 'internal.example.test' ? '10.0.0.5' : '104.18.1.2' }]);
    const fetchMock = stubFetch(redirect('https://internal.example.test/secret'));
    await expect(safeFetch(`${PUBLIC}/feed`)).rejects.toThrow('Blocked host: internal.example.test');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('une redirection vers http est refusée', async () => {
    const fetchMock = stubFetch(redirect('http://insecure.example.net/x'));
    await expect(safeFetch(`${PUBLIC}/feed`)).rejects.toThrow('Only https URLs are allowed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('plus de dix sauts : refusé', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => redirect('/encore'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetch(`${PUBLIC}/feed`)).rejects.toThrow('Trop de redirections');
    expect(fetchMock).toHaveBeenCalledTimes(11);
  });

  it('le corps d\u0027une réponse de redirection est libéré', async () => {
    const cancel = vi.fn();
    const fetchMock = stubFetch(new Response(stream([4], cancel), { status: 302, headers: { location: '/next' } }), new Response('ok'));
    await safeFetch(`${PUBLIC}/first`);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('redirect manual : la réponse de redirection est rendue telle quelle', async () => {
    const fetchMock = stubFetch(redirect('/elsewhere'));
    const response = await safeFetch(`${PUBLIC}/file`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/elsewhere');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('redirect error : toute redirection est refusée', async () => {
    const fetchMock = stubFetch(redirect('/elsewhere'));
    await expect(safeFetch(`${PUBLIC}/file`, { redirect: 'error' })).rejects.toThrow('Redirection refusée');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un POST suivi en 303 repart en GET sans corps ni type de contenu', async () => {
    const fetchMock = stubFetch(redirect('/done', 303), new Response('ok'));
    await safeFetch(`${PUBLIC}/submit`, { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
    const replayed = initOf(fetchMock.mock.calls[1]);
    expect(replayed.method).toBe('GET');
    expect(replayed.body).toBeUndefined();
    expect(new Headers(replayed.headers).has('content-type')).toBe(false);
  });

  it('un POST suivi en 307 rejoue la requête à l\u0027identique', async () => {
    const fetchMock = stubFetch(redirect('/again', 307), new Response('ok'));
    await safeFetch(`${PUBLIC}/submit`, { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
    const replayed = initOf(fetchMock.mock.calls[1]);
    expect(replayed.method).toBe('POST');
    expect(String(replayed.body)).toBe('{"a":1}');
    expect(new Headers(replayed.headers).get('content-type')).toBe('application/json');
  });
});

describe('lecture plafonnée', () => {
  beforeEach(() => {
    dns.lookup.mockResolvedValue([{ address: '104.18.1.2' }]);
  });

  it('le texte est lu tel quel', async () => {
    stubFetch(new Response('bonjour'));
    expect(await safeFetchText(`${PUBLIC}/x`)).toBe('bonjour');
  });

  it('les octets sont conservés tels quels', async () => {
    const bytes = Buffer.from([0xff, 0x00, 0x10, 0xfe]);
    stubFetch(new Response(bytes));
    expect((await safeFetchBytes(`${PUBLIC}/x`)).equals(bytes)).toBe(true);
  });

  it('une longueur déclarée au-dessus du plafond est refusée sans lire le corps', async () => {
    const cancel = vi.fn();
    stubFetch(new Response(endless(4, cancel), { headers: { 'content-length': '999' } }));
    await expect(safeFetchBytes(`${PUBLIC}/x`, { maxBytes: 8 })).rejects.toBeInstanceOf(OversizedResponseError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('un flux qui dépasse le plafond est coupé dès le dépassement', async () => {
    const cancel = vi.fn();
    stubFetch(new Response(endless(5, cancel)));
    await expect(safeFetchBytes(`${PUBLIC}/x`, { maxBytes: 8 })).rejects.toThrow('plafond : 8 octets');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('un corps exactement à la limite passe', async () => {
    stubFetch(new Response(stream([8])));
    expect((await safeFetchBytes(`${PUBLIC}/x`, { maxBytes: 8 })).byteLength).toBe(8);
  });

  it('le plafond par défaut est de 5 Mo', async () => {
    const cancel = vi.fn();
    stubFetch(new Response(endless(1024 * 1024, cancel)));
    await expect(safeFetchText(`${PUBLIC}/big`)).rejects.toThrow('plafond : 5 Mo');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('JSON : parsé ; un corps vide ou non JSON est une erreur', async () => {
    stubFetch(new Response('{"a":1}'));
    expect(await safeFetchJson<{ a: number }>(`${PUBLIC}/x`)).toEqual({ a: 1 });
    stubFetch(new Response(null));
    await expect(safeFetchJson(`${PUBLIC}/empty`)).rejects.toThrow();
    stubFetch(new Response('<html>'));
    await expect(safeFetchJson(`${PUBLIC}/html`)).rejects.toThrow();
  });
});
