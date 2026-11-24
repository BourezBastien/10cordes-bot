import { z } from 'zod';
import { searchDuckDuckGo } from 'ts-duckduckgo-search';
import { XMLParser } from 'fast-xml-parser';
import type { BotTool } from '@10cordes/shared';
import { safeFetchText } from '../../shared/utils/safe-fetch';
import { SAFE_XML_OPTIONS, assertSafeXml, xmlAt, xmlLink, xmlList, xmlText } from './xml-guard';

/** Flux officiels des sources de presse établie. */
const NEWS_FEEDS: Readonly<Record<'lemonde' | 'france24', string>> = {
  lemonde: 'https://www.lemonde.fr/rss/une.xml',
  france24: 'https://www.france24.com/fr/rss',
};

/** Recherche DuckDuckGo : titres, descriptions et URLs des 5 premiers résultats exploitables. */
async function searchWeb(query: string): Promise<Array<{ title: string; description: string; url: string }>> {
  const results = (await searchDuckDuckGo(query, {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  })) as Array<{ title?: string; description?: string; url?: string }>;
  return results
    .filter((row) => row.url && row.title)
    .slice(0, 5)
    .map((row) => ({ title: String(row.title), description: String(row.description ?? '').slice(0, 200), url: String(row.url) }));
}

/**
 * Lit un flux gardé et rend ses articles (titre, lien, date), au plus `limit`.
 * Le flux vient de n'importe où : requête gardée (hôte public, taille
 * plafonnée), XML refusé s'il déclare un DOCTYPE ou des entités, puis analysé
 * sans en développer une seule.
 */
async function readFeed(url: string, limit: number): Promise<string[]> {
  const xml = await safeFetchText(url);
  assertSafeXml(xml);
  const parsed: unknown = new XMLParser(SAFE_XML_OPTIONS).parse(xml);
  const items = [...xmlList(xmlAt(parsed, ['rss', 'channel', 'item'])), ...xmlList(xmlAt(parsed, ['feed', 'entry']))];
  return items.slice(0, limit).map((item, index) => {
    const title = xmlText(xmlAt(item, ['title'])) || '(sans titre)';
    const link = xmlLink(item);
    const date = xmlText(xmlAt(item, ['pubDate'])) || xmlText(xmlAt(item, ['updated']));
    return `${index + 1}. ${title}${link ? ` : ${link}` : ''}${date ? ` (${date})` : ''}`;
  });
}

/**
 * Tools de recherche web et d'actualités : DuckDuckGo, lecture d'un flux RSS/Atom
 * fourni par l'utilisateur, dépêches de presse établie. Ordre d'origine dans le
 * registry : searchInternet, readRssFeed, getNews.
 */
export function buildSearchTools(): BotTool[] {
  return [
    {
      name: 'searchInternet',
      description: 'Recherche sur internet (DuckDuckGo) : renvoie titres, descriptions et URLs des résultats.',
      category: 'web',
      paramsSchema: z.object({ query: z.string().min(2).max(400) }),
      requiredModules: [],
      destructive: false,
      systemPrompt:
        'Pour les infos d\u0027actualité, récentes ou que tu ne connais pas : cherche AVANT de répondre. DOCTRINE DES SOURCES : croise au moins 2 sources indépendantes, cite les URLs de chaque source utilisée, ne publie que si les faits sont cohérents entre elles ; en cas de divergence signale-la, sans sources fiables dis « je ne sais pas » et propose où chercher. Préfère presse établie (Le Monde, France24 via getNews) et Wikipédia (searchWikipedia).',
      handler: async (input, _ctx) => {
        const { query } = input as { query: string };
        const results = await searchWeb(query);
        if (results.length === 0) return { ok: false, summary: 'Aucun résultat trouvé.' };
        return {
          ok: true,
          summary: results.map((row, index) => `${index + 1}. ${row.title} : ${row.description} (${row.url})`).join(' | ').slice(0, 2000),
          data: { results },
        };
      },
    },
    {
      name: 'readRssFeed',
      description: 'Lit un flux RSS/Atom et renvoie les derniers articles (titre, lien, date).',
      category: 'web',
      paramsSchema: z.object({
        url: z.string().url().max(500),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Seulement des flux fournis par l\u0027utilisateur, en https. Les dates sont au format ISO.',
      handler: async (input, _ctx) => {
        const { url, limit } = input as { url: string; limit?: number };
        if (!/^https:\/\//i.test(url)) return { ok: false, summary: 'URL invalide : un flux se lit en https uniquement.' };
        const lines = await readFeed(url, limit ?? 5);
        if (lines.length === 0) return { ok: false, summary: 'Aucun article dans ce flux.' };
        return { ok: true, summary: lines.join(' | ').slice(0, 2000), data: { count: lines.length } };
      },
    },
    {
      name: 'getNews',
      description: 'Dernières actualités de sources vérifiées (Le Monde, France24 : flux RSS officiels).',
      category: 'web',
      paramsSchema: z.object({
        source: z.enum(['lemonde', 'france24']).default('lemonde'),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      requiredModules: [],
      destructive: false,
      systemPrompt:
        'Sources vérifiées uniquement (presse établie). Liste les titres avec leurs liens pour que l\u0027utilisateur aille vérifier lui-même.',
      handler: async (input, _ctx) => {
        const { source, limit } = input as { source?: 'lemonde' | 'france24'; limit?: number };
        const lines = await readFeed(NEWS_FEEDS[source ?? 'lemonde'], limit ?? 5);
        if (lines.length === 0) return { ok: false, summary: 'Aucune actualité récupérée.' };
        return { ok: true, summary: `Actualités (${source === 'france24' ? 'France24' : 'Le Monde'}) : ${lines.join(' | ')}` };
      },
    },
  ];
}
