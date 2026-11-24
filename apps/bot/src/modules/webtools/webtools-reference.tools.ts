import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { safeFetchJson } from '../../shared/utils/safe-fetch';

/**
 * Tools d'ouvrages de référence : fiche d'un pays, dictionnaire anglais,
 * paroles de chanson, résumé Wikipédia. Ordre d'origine dans le registry :
 * getCountryInfo, defineWord, getLyrics, searchWikipedia. Chaque appel passe
 * par la garde des requêtes sortantes.
 */
export function buildReferenceTools(): BotTool[] {
  return [
    {
      name: 'getCountryInfo',
      description: 'Infos officielles sur un pays : capitale, population, devise, langues, drapeau (restcountries).',
      category: 'web',
      paramsSchema: z.object({ country: z.string().min(2).max(60) }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Source : restcountries.com. Cite-la.',
      handler: async (input, _ctx) => {
        const { country } = input as { country: string };
        const data = (await safeFetchJson<unknown>(
          `https://restcountries.com/v3.1/name/${encodeURIComponent(country)}?fields=name,capital,population,currencies,languages,flags`,
        ).catch(() => null)) as
          | Array<{
              name: { common: string };
              capital?: string[];
              population?: number;
              currencies?: Record<string, unknown>;
              languages?: Record<string, string>;
              flags?: { png?: string };
            }>
          | { status?: number }
          | null;
        if (!Array.isArray(data) || data.length === 0) return { ok: false, summary: 'Pays introuvable.' };
        const c = data[0];
        const currency = Object.keys(c.currencies ?? {})[0] ?? '?';
        const languages = Object.values(c.languages ?? {}).join(', ') || '?';
        return {
          ok: true,
          summary: `${c.name.common} : capitale ${c.capital?.[0] ?? '?'}, population ${(c.population ?? 0).toLocaleString('fr-FR')}, devise ${currency}, langues ${languages}. Drapeau : ${c.flags?.png ?? ''}`,
          data: { country: c.name.common },
        };
      },
    },
    {
      name: 'defineWord',
      description: 'Définitions, prononciation et exemples d\u0027un mot anglais (Free Dictionary API).',
      category: 'web',
      paramsSchema: z.object({ word: z.string().min(1).max(60) }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Source : dictionaryapi.dev. Traduis/paraphrase la définition pour l\u0027utilisateur français.',
      handler: async (input, _ctx) => {
        const { word } = input as { word: string };
        // Un mot inconnu répond 404 avec un objet : la réponse est lue quel que soit le statut.
        const data = await safeFetchJson<
          | Array<{
              meanings?: Array<{ partOfSpeech: string; definitions?: Array<{ definition: string }> }>;
              phonetic?: string;
            }>
          | { title?: string }
        >(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
        if (!Array.isArray(data) || data.length === 0) return { ok: false, summary: `Mot « ${word} » introuvable dans le dictionnaire.` };
        const first = data[0];
        const def = first.meanings?.[0]?.definitions?.[0]?.definition ?? '';
        return {
          ok: true,
          summary: `« ${word} » (${first.phonetic ?? ''}, ${first.meanings?.[0]?.partOfSpeech ?? '?'}) : ${def} (source : dictionaryapi.dev)`,
        };
      },
    },
    {
      name: 'getLyrics',
      description: 'Paroles d\u0027une chanson (artiste + titre, lyrics.ovh).',
      category: 'web',
      paramsSchema: z.object({
        artist: z.string().min(1).max(80),
        title: z.string().min(1).max(100),
      }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Paroles complètes longues : extrais le refrain ou les 8 premières lignes et donne le lien source.',
      handler: async (input, _ctx) => {
        const { artist, title } = input as { artist: string; title: string };
        const data = await safeFetchJson<{ lyrics?: string; error?: string }>(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
        if (!data?.lyrics) return { ok: false, summary: 'Paroles introuvables pour ce titre.' };
        return {
          ok: true,
          summary: `Paroles « ${title} » (${artist}) : ${data.lyrics.slice(0, 1200)}… (source : lyrics.ovh)`,
        };
      },
    },
    {
      name: 'searchWikipedia',
      description: 'Résumé Wikipédia d\u0027un sujet (français ou anglais) avec lien de l\u0027article.',
      category: 'web',
      paramsSchema: z.object({
        topic: z.string().min(2).max(120),
        lang: z.enum(['fr', 'en']).default('fr'),
      }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Source Wikipédia : cite toujours le lien de l\u0027article. À croiser avec searchInternet pour les faits contestés.',
      handler: async (input, _ctx) => {
        const { topic, lang } = input as { topic: string; lang?: string };
        const host = lang === 'en' ? 'en' : 'fr';
        const data = await safeFetchJson<{ title?: string; extract?: string; content_urls?: { desktop?: { page?: string } } }>(
          `https://${host}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
        );
        if (!data?.extract) return { ok: false, summary: 'Article Wikipédia introuvable pour ce sujet.' };
        return {
          ok: true,
          summary: `${data.title} (Wikipédia ${host.toUpperCase()}) : ${data.extract.slice(0, 800)} Lien : ${data.content_urls?.desktop?.page ?? ''}`,
        };
      },
    },
  ];
}
