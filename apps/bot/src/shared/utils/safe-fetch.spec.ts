import { afterEach, describe, expect, it, vi } from 'vitest';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));

const { assertPublicHost, assertSafeUrl, safeFetch } = await import('./safe-fetch');

/**
 * Garde des requêtes sortantes. Un nom public qui résout vers une adresse
 * interne est la façon la plus courante d'atteindre le réseau du serveur :
 * la forme de l'hôte ne suffit pas, son adresse résolue décide aussi.
 */

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
    await expect(safeFetch('https://api.example.test/v1/models')).rejects.toThrow('Blocked host');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un hôte public est appelé, avec l\u0027URL validée', async () => {
    dns.lookup.mockResolvedValue([{ address: '104.18.1.2' }]);
    const fetchMock = vi.fn(async (_input: string | URL | Request) => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const response = await safeFetch('https://api.example.test/v1/models');
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.example.test/v1/models');
  });
});
