import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { z } from 'zod';
import { searchDuckDuckGo } from 'ts-duckduckgo-search';
import PDFDocument from 'pdfkit';
import { XMLParser } from 'fast-xml-parser';
import type { BotTool, ToolRunContext } from '@10cordes/shared';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';

/**
 * Tools de capacités web et fichiers (inspiration Discord-AI-Bot) :
 * recherche internet, génération de PDF, météo, GitHub, flux RSS.
 * Aucune clé API requise : DuckDuckGo, Open-Meteo et GitHub (anonyme) sont
 * gratuits ; les PDF sont générés localement avec pdfkit.
 */

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

function renderPdf(title: string, content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 60, right: 60 } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).fillColor('#d95926').text(title, { underline: false });
    doc.moveDown(1);
    doc.fontSize(11).fillColor('#111114');
    for (const paragraph of content.split(/\n{2,}/)) {
      doc.text(paragraph.trim(), { paragraphGap: 8 });
      doc.moveDown(0.5);
    }
    doc.end();
  });
}

@Injectable()
export class WebToolsService implements SpraxiumOnBoot {
  private readonly log = new Logger('WebTools');
  private readonly xmlParser = new XMLParser({ ignoreAttributes: false });

  constructor(private readonly registry: ToolRegistryService) {}

  onBoot(): void {
    for (const tool of this.buildTools()) this.registry.register(tool);
    this.log.info(`${this.buildTools().length} tools web enregistrés`);
  }

  private buildTools(): BotTool[] {
    const sendFileOf = (ctx: ToolRunContext) => ctx.sendFile;

    return [
      {
        name: 'searchInternet',
        description: 'Recherche sur internet (DuckDuckGo) : renvoie titres, descriptions et URLs des résultats.',
        category: 'web',
        paramsSchema: z.object({ query: z.string().min(2).max(400) }),
        requiredModules: [],
        destructive: false,
        systemPrompt:
          'Pour les infos d\u2019actualité, récentes ou que tu ne connais pas : cherche AVANT de répondre, puis cite les sources (URLs) dans ta réponse.',
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
        name: 'generatePdf',
        description:
          "Génère un PDF structuré (titre + contenu texte, sauts de ligne doubles = nouveaux paragraphes) et l'envoie dans le salon. content : texte markdown léger.",
        category: 'web',
        paramsSchema: z.object({
          title: z.string().min(1).max(200),
          content: z.string().min(10).max(20000),
          filename: z.string().min(1).max(60).default('document'),
          targetChannelId: z.string().min(1).optional(),
        }),
        requiredModules: [],
        permissions: ['AttachFiles'],
        destructive: false,
        systemPrompt:
          'Utilise-le quand on demande un PDF, un document, un rapport mis en page. Le contenu est du TEXTE structuré (paragraphes séparés par une ligne vide) : construis-le complet avant d\u2019appeler.',
        handler: async (input, ctx) => {
          const sendFile = sendFileOf(ctx);
          if (!sendFile) return { ok: false, summary: 'Envoi de fichiers indisponible sur cette surface.' };
          const { title, content, filename } = input as { title: string; content: string; filename?: string; targetChannelId?: string };
          const targetChannelId = (input as { targetChannelId?: string }).targetChannelId;
          const pdf = await renderPdf(title, content);
          const safeName = `${(filename || title).replace(/[^a-zA-Z0-9-_]/gu, '-').slice(0, 50)}.pdf`;
          await sendFile({ name: safeName, attachment: pdf }, targetChannelId);
          return { ok: true, summary: `PDF **${safeName}** généré (${Math.round(pdf.length / 1024)} Ko) et envoyé.` };
        },
      },
      {
        name: 'getWeather',
        description: 'Météo actuelle + prévisions du jour pour une ville (Open-Meteo, mondial).',
        category: 'web',
        paramsSchema: z.object({ city: z.string().min(2).max(80) }),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Cherche la ville via le géocodage intégré : aucun ID à deviner. Convertis les codes météo en texte français.',
        handler: async (input, _ctx) => {
          const { city } = input as { city: string };
          const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`)
            .then((res) => res.json() as Promise<{ results?: Array<{ latitude: number; longitude: number; name: string; country: string }> }>);
          const place = geo.results?.[0];
          if (!place) return { ok: false, summary: `Ville « ${city} » introuvable.` };
          const forecast = (await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`,
          ).then((res) => res.json())) as {
            current?: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
            daily?: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
          };
          const current = forecast.current;
          if (!current) return { ok: false, summary: 'Prévisions indisponibles.' };
          const codes: Record<number, string> = { 0: 'ciel dégagé', 1: 'peu nuageux', 2: 'partiellement nuageux', 3: 'couvert', 45: 'brouillard', 51: 'bruine légère', 61: 'pluie légère', 63: 'pluie', 65: 'pluie forte', 71: 'neige légère', 73: 'neige', 75: 'neige forte', 80: 'averses', 95: 'orage' };
          const label = codes[current.weather_code] ?? `code ${current.weather_code}`;
          const day = forecast.daily;
          const summary = `Météo à ${place.name} (${place.country}) : ${label}, ${Math.round(current.temperature_2m)}°C (ressenti ${Math.round(current.apparent_temperature)}°C), vent ${Math.round(current.wind_speed_10m)} km/h.${day ? ` Jour : ${Math.round(day.temperature_2m_min[0])} à ${Math.round(day.temperature_2m_max[0])}°C, pluie ${day.precipitation_probability_max[0]}%.` : ''}`;
          return { ok: true, summary, data: { place: place.name, ...current } };
        },
      },
      {
        name: 'githubRepo',
        description: 'Infos sur un dépôt GitHub (propriétaire/nom) : description, étoiles, langage, dernière release.',
        category: 'web',
        paramsSchema: z.object({ repo: z.string().min(3).max(120).describe('Format propriétaire/nom, ex: discordjs/discord.js') }),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Format strict propriétaire/nom. Utile pour suivre des projets et leurs versions.',
        handler: async (input, _ctx) => {
          const { repo } = input as { repo: string };
          const clean = repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
          const headers = { 'User-Agent': '10cordes-bot', Accept: 'application/vnd.github+json' };
          const info = (await fetch(`https://api.github.com/repos/${clean}`, { headers }).then((res) => res.json())) as {
            full_name?: string;
            description?: string;
            stargazers_count?: number;
            forks_count?: number;
            language?: string;
            html_url?: string;
            message?: string;
          };
          if (info.message) return { ok: false, summary: `Dépôt introuvable : ${info.message}` };
          const release = (await fetch(`https://api.github.com/repos/${clean}/releases/latest`, { headers })
            .then((res) => res.json())
            .catch(() => ({}))) as { tag_name?: string; name?: string };
          return {
            ok: true,
            summary: `${info.full_name} : ${info.description ?? 'sans description'}, ${info.stargazers_count ?? 0} étoiles, ${info.forks_count ?? 0} forks, langage ${info.language ?? '?'}${release.tag_name ? `, dernière version ${release.tag_name}` : ''}. ${info.html_url ?? ''}`,
            data: { ...info, latestRelease: release.tag_name ?? null },
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
        systemPrompt: 'Seulement des flux fournis par l\u2019utilisateur. Les dates sont au format ISO.',
        handler: async (input, _ctx) => {
          const { url, limit } = input as { url: string; limit?: number };
          if (!/^https?:\/\//i.test(url)) return { ok: false, summary: 'URL invalide.' };
          const xml = await fetch(url).then((res) => res.text());
          const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml) as {
            rss?: { channel?: { item?: unknown } };
            feed?: { entry?: unknown };
          };
          const items = (parsed.rss?.channel?.item ?? parsed.feed?.entry ?? []) as Array<{
            title?: string | { '#text': string };
            link?: string | { '#text': string; '@_href': string };
            pubDate?: string;
            updated?: string;
          }>;
          const list = Array.isArray(items) ? items.slice(0, limit ?? 5) : [];
          if (list.length === 0) return { ok: false, summary: 'Aucun article dans ce flux.' };
          const lines = list.map((item, index) => {
            const title = typeof item.title === 'string' ? item.title : (item.title as { '#text'?: string })?.['#text'] ?? '?';
            const link = typeof item.link === 'string' ? item.link : (item.link as { '@_href'?: string })?.['@_href'] ?? '';
            const date = item.pubDate ?? item.updated ?? '';
            return `${index + 1}. ${title}${link ? ` : ${link}` : ''}${date ? ` (${date})` : ''}`;
          });
          return { ok: true, summary: lines.join(' | ').slice(0, 2000), data: { count: lines.length } };
        },
      },
    ];
  }
}
