import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotTool, ToolRunContext } from '@10cordes/shared';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));

const { buildGithubTools } = await import('./webtools-github.tools');
const { buildPracticalTools } = await import('./webtools-practical.tools');
const { buildDisdexTools } = await import('./webtools-disdex.tools');

/**
 * Outils web sur des API tierces. Les réponses ci-dessous sont observées sur
 * les API réelles (24/11/2026) : ipwho.is (succès, plage réservée) et
 * Frankfurter (nouvelle adresse api.frankfurter.dev).
 */

const IPWHO_PUBLIC =
  '{"ip":"8.8.8.8","success":true,"type":"IPv4","continent":"North America","country":"United States","country_code":"US","region":"California","city":"San Jose","latitude":37.3393939,"longitude":-121.8949553,"connection":{"asn":15169,"org":"Google LLC","isp":"Google LLC","domain":"google.com"}}';

const FRANKFURTER = '{"amount":10.0,"base":"EUR","date":"2026-11-24","rates":{"USD":10.963}}';

const fetchMock = vi.fn<typeof fetch>();

/** Remplace `fetch` par une suite de réponses, dans l'ordre des appels. */
function stubFetch(...bodies: string[]): void {
  fetchMock.mockReset();
  for (const body of bodies) fetchMock.mockResolvedValueOnce(new Response(body));
  vi.stubGlobal('fetch', fetchMock);
}

const requestedUrl = (call = 0): string => String(fetchMock.mock.calls[call]?.[0]);

async function run(tools: BotTool[], tool: string, input: unknown): Promise<{ ok: boolean; summary: string; data?: unknown }> {
  const found = tools.find((entry) => entry.name === tool);
  if (!found) throw new Error(`Outil absent : ${tool}`);
  return found.handler(input, {} as ToolRunContext);
}

beforeEach(() => {
  dns.lookup.mockResolvedValue([{ address: '104.18.1.2' }]);
  fetchMock.mockReset();
});

afterEach(() => {
  dns.lookup.mockReset();
  vi.unstubAllGlobals();
});

describe('lookupIp (ipwho.is, en https)', () => {
  it('une adresse publique est localisée', async () => {
    stubFetch(IPWHO_PUBLIC);
    const result = await run(buildPracticalTools(), 'lookupIp', { ip: '8.8.8.8' });
    expect(result).toEqual({ ok: true, summary: '8.8.8.8 : San Jose, United States (FAI : Google LLC, source ipwho.is).' });
    expect(requestedUrl()).toBe('https://ipwho.is/8.8.8.8');
  });

  it('une plage réservée est refusée, avec la raison de la source', async () => {
    stubFetch('{"ip":"192.168.1.1","success":false,"message":"Reserved range"}');
    const result = await run(buildPracticalTools(), 'lookupIp', { ip: '192.168.1.1' });
    expect(result).toEqual({ ok: false, summary: 'IP introuvable ou privée (Reserved range).' });
  });

  it('l\u0027adresse demandée est encodée dans le chemin : elle ne change pas la cible', async () => {
    stubFetch(IPWHO_PUBLIC);
    await run(buildPracticalTools(), 'lookupIp', { ip: '../autre/chemin' });
    expect(requestedUrl()).toBe('https://ipwho.is/..%2Fautre%2Fchemin');
  });
});

describe('convertCurrency', () => {
  it('appelle la nouvelle adresse de Frankfurter et rend le taux', async () => {
    stubFetch(FRANKFURTER);
    const result = await run(buildPracticalTools(), 'convertCurrency', { amount: 10, from: 'eur', to: 'usd' });
    expect(result).toEqual({ ok: true, summary: '10 EUR = 10.963 USD (source : Frankfurter/BCE).', data: { rate: 10.963 } });
    expect(requestedUrl()).toBe('https://api.frankfurter.dev/v1/latest?amount=10&from=EUR&to=USD');
  });

  it('une devise inconnue rend un échec explicite', async () => {
    stubFetch('{"message":"not found"}');
    const result = await run(buildPracticalTools(), 'convertCurrency', { amount: 10, from: 'EUR', to: 'XXX' });
    expect(result).toEqual({ ok: false, summary: 'Devises inconnues ou non supportées.' });
  });
});

describe('githubRepo', () => {
  it.each(['../../../../users/octocat', 'owner/..', 'owner/./repo', 'owner/repo/tree/main', 'seul'])('%s : refusé sans requête, le nom demandé part dans le chemin de l\u0027API', async (repo) => {
    stubFetch('{"full_name":"owner/repo"}');
    const result = await run(buildGithubTools(), 'githubRepo', { repo });
    expect(result).toEqual({ ok: false, summary: 'Format attendu : propriétaire/nom (ex : discordjs/discord.js).' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['owner/repo', 'https://api.github.com/repos/owner/repo'],
    ['https://github.com/owner/repo', 'https://api.github.com/repos/owner/repo'],
    ['owner/repo.git/', 'https://api.github.com/repos/owner/repo'],
  ])('%s : la fiche est demandée à l\u0027API', async (repo, url) => {
    stubFetch('{"full_name":"owner/repo","stargazers_count":12}', '{"message":"Not Found"}');
    const result = await run(buildGithubTools(), 'githubRepo', { repo });
    expect(result.ok).toBe(true);
    expect(requestedUrl(0)).toBe(url);
    expect(requestedUrl(1)).toBe(`${url}/releases/latest`);
    expect(result.data).toMatchObject({ latestRelease: null });
  });
});

describe('discordUserLookup', () => {
  it('le schéma n\u0027accepte qu\u0027un identifiant numérique', () => {
    const tool = buildDisdexTools().find((entry) => entry.name === 'discordUserLookup');
    if (!tool) throw new Error('Outil absent');
    expect(tool.paramsSchema.safeParse({ userId: '1550835980116824136' }).success).toBe(true);
    expect(tool.paramsSchema.safeParse({ userId: '../servers?limit=9' }).success).toBe(false);
  });
});
