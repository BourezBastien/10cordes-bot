import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotTool, ToolRunContext } from '@10cordes/shared';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));

const { buildSearchTools } = await import('./webtools-search.tools');

/**
 * Lecture des flux RSS. Le flux vient de n'importe où : il n'est lu qu'en
 * https sur un hôte public, et refusé avant analyse s'il déclare un DOCTYPE
 * ou une entité. Le premier fixture est un extrait observé du flux du Monde
 * (24/11/2026), réduit à deux articles.
 */

const LEMONDE_EXCERPT =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Le Monde.fr - Actualités et Infos en France et dans le monde</title>' +
  '<item><title><![CDATA[Derrière l’affaire Nvidia, un vaste réseau de détournement de puces d’IA au service de la Chine]]></title><pubDate>Tue, 24 Nov 2026 16:49:58 +0100</pubDate><guid isPermaLink="true">https://www.lemonde.fr/economie/article/2026/11/24/derriere-l-affaire-nvidia-un-vaste-reseau-de-detournement-de-puces-d-ia-au-service-de-la-chine_6814811_3234.html</guid><link>https://www.lemonde.fr/economie/article/2026/11/24/derriere-l-affaire-nvidia-un-vaste-reseau-de-detournement-de-puces-d-ia-au-service-de-la-chine_6814811_3234.html</link></item>' +
  '<item><title><![CDATA[Deuxième titre]]></title><link>https://www.lemonde.fr/deuxieme</link></item></channel></rss>';

const ESCAPED_FEED =
  '<rss version="2.0"><channel><item><title>Tom &amp; Jerry &#39;à la campagne&#39; &lt;b&gt; &lol;</title><link>https://x.test/a?b=1&amp;c=2</link></item>' +
  '<item><title>007</title><link>https://x.test/sept</link></item></channel></rss>';

const ATOM_FEED =
  '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Un billet</title><link rel="self" href="https://x.test/feed"/><link rel="alternate" href="https://x.test/billet?x=1&amp;y=2"/><updated>2026-11-24T10:00:00Z</updated></entry></feed>';

let tools: BotTool[];

const fetchMock = vi.fn<typeof fetch>();

/** Remplace `fetch` par une suite de réponses, dans l'ordre des appels. */
function stubFetch(...bodies: string[]): void {
  fetchMock.mockReset();
  for (const body of bodies) fetchMock.mockResolvedValueOnce(new Response(body));
  vi.stubGlobal('fetch', fetchMock);
}

const run = (tool: string, input: unknown): Promise<{ ok: boolean; summary: string; data?: unknown }> => {
  const found = tools.find((entry) => entry.name === tool);
  if (!found) throw new Error(`Outil absent : ${tool}`);
  return found.handler(input, {} as ToolRunContext);
};

const requestedUrl = (call = 0): string => String(fetchMock.mock.calls[call]?.[0]);

beforeEach(() => {
  dns.lookup.mockResolvedValue([{ address: '104.18.1.2' }]);
  tools = buildSearchTools();
});

afterEach(() => {
  dns.lookup.mockReset();
  vi.unstubAllGlobals();
});

describe('readRssFeed', () => {
  it('un flux en http est refusé sans aucune requête', async () => {
    stubFetch(LEMONDE_EXCERPT);
    const result = await run('readRssFeed', { url: 'http://x.test/feed.xml' });
    expect(result).toMatchObject({ ok: false, summary: 'URL invalide : un flux se lit en https uniquement.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('les articles d\u0027un flux réel sont listés : titre, lien et date', async () => {
    stubFetch(LEMONDE_EXCERPT);
    const result = await run('readRssFeed', { url: 'https://www.lemonde.fr/rss/une.xml', limit: 1 });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ count: 1 });
    expect(result.summary).toBe(
      '1. Derrière l’affaire Nvidia, un vaste réseau de détournement de puces d’IA au service de la Chine : https://www.lemonde.fr/economie/article/2026/11/24/derriere-l-affaire-nvidia-un-vaste-reseau-de-detournement-de-puces-d-ia-au-service-de-la-chine_6814811_3234.html (Tue, 24 Nov 2026 16:49:58 +0100)',
    );
    expect(requestedUrl()).toBe('https://www.lemonde.fr/rss/une.xml');
  });

  it('la limite par défaut garde cinq articles', async () => {
    stubFetch(LEMONDE_EXCERPT);
    const result = await run('readRssFeed', { url: 'https://www.lemonde.fr/rss/une.xml' });
    expect(result.data).toEqual({ count: 2 });
    expect(result.summary).toContain('2. Deuxième titre : https://www.lemonde.fr/deuxieme');
  });

  it('un flux qui déclare un DOCTYPE ou une entité est refusé avant analyse', async () => {
    for (const hostile of ['<!DOCTYPE rss [<!ENTITY lol "lol">]><rss/>', '<rss><!ENTITY x "y"/></rss>']) {
      stubFetch(hostile);
      await expect(run('readRssFeed', { url: 'https://x.test/feed.xml' })).rejects.toThrow('DOCTYPE ou des entités');
    }
  });

  it('un texte échappé est décodé une seule fois, une entité inconnue reste telle quelle, un titre numérique reste un texte', async () => {
    stubFetch(ESCAPED_FEED);
    const result = await run('readRssFeed', { url: 'https://x.test/feed.xml' });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("1. Tom & Jerry 'à la campagne' <b> &lol; : https://x.test/a?b=1&c=2 | 2. 007 : https://x.test/sept");
  });

  it('un flux Atom est lu : lien alternatif, date de mise à jour', async () => {
    stubFetch(ATOM_FEED);
    const result = await run('readRssFeed', { url: 'https://x.test/atom.xml' });
    expect(result.summary).toBe('1. Un billet : https://x.test/billet?x=1&y=2 (2026-11-24T10:00:00Z)');
  });

  it('un document sans article rend un échec explicite', async () => {
    stubFetch('<rss><channel><title>Vide</title></channel></rss>');
    expect(await run('readRssFeed', { url: 'https://x.test/vide.xml' })).toMatchObject({ ok: false, summary: 'Aucun article dans ce flux.' });
  });
});

describe('getNews', () => {
  it('source du Monde par défaut, France24 à la demande', async () => {
    stubFetch(LEMONDE_EXCERPT, LEMONDE_EXCERPT);
    const lemonde = await run('getNews', { limit: 1 });
    expect(lemonde.summary).toContain('Actualités (Le Monde) : 1. Derrière l’affaire Nvidia');
    expect(requestedUrl(0)).toBe('https://www.lemonde.fr/rss/une.xml');
    const france24 = await run('getNews', { source: 'france24', limit: 1 });
    expect(france24.summary).toContain('Actualités (France24) :');
    expect(requestedUrl(1)).toBe('https://www.france24.com/fr/rss');
  });
});
