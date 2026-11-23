import { generateFromMessages, ExportReturnType } from 'discord-html-transcripts';
import type { GuildMember } from 'discord.js';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import type { UtilityToolsDeps } from './utility-resolver';

/**
 * Tools de lecture et d'export : recherche dans l'historique d'un salon,
 * export des derniers messages (JSON, CSV ou transcript HTML), export de
 * l'annuaire des membres.
 */

/** Tool channel.history.search : recherche filtrée, en lecture seule, dans l'historique d'un salon. */
export function channelHistorySearchTool(deps: UtilityToolsDeps): BotTool {
  const { resolver } = deps;
  return {
    name: 'channel.history.search',
    description: "Recherche filtrée dans l'historique d'un salon : sous-chaîne, auteur, fenêtre en jours (jusqu'à 500 messages scannés).",
    category: 'utility',
    paramsSchema: z.object({
      channelId: z.string().min(1),
      contains: z.string().max(100).optional(),
      userId: z.string().optional(),
      days: z.number().int().min(1).max(365).default(7),
    }),
    requiredModules: [],
    permissions: ['ReadMessageHistory'],
    destructive: false,
    systemPrompt: 'Read-only. Résultats limités à 10 lignes avec date et auteur.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { channelId, contains, userId, days } = input as { channelId: string; contains?: string; userId?: string; days?: number };
      const channel = resolver.textChannel(ctx.guildId, channelId);
      if (!channel) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
      const windowMs = (days ?? 7) * 86_400_000;
      const found: string[] = [];
      let lastId: string | undefined;
      for (let page = 0; page < 5 && found.length < 10; page++) {
        const batch = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
        if (!batch || batch.size === 0) break;
        lastId = batch.last()?.id;
        for (const message of batch.values()) {
          // Les messages sont du plus récent au plus ancien : dès qu'on
          // franchit la fenêtre, tout le reste de la pagination est plus
          // vieux — on STOPPE la pagination (l'ancien `continue` sur la
          // boucle interne fetchait des pages entières pour rien).
          if (Date.now() - message.createdTimestamp > windowMs) {
            page = 5;
            break;
          }
          if (userId && message.author.id !== userId) continue;
          if (contains && !message.content.toLowerCase().includes(contains.toLowerCase())) continue;
          const when = new Date(message.createdTimestamp).toISOString().slice(0, 16).replace('T', ' ');
          found.push(`[${when}] ${message.author.username} : ${(message.content || '(sans texte)').slice(0, 100)}`);
          if (found.length >= 10) break;
        }
      }
      return { ok: true, summary: found.length > 0 ? found.join(' | ') : 'Aucun message correspondant dans la fenêtre.' };
    },
  };
}

/** Tool messages.export : exporte les derniers messages d'un salon en pièce jointe JSON, CSV ou HTML. */
export function messagesExportTool(deps: UtilityToolsDeps): BotTool {
  const { resolver } = deps;
  return {
    name: 'messages.export',
    description: 'Exporte les derniers messages d\u0027un salon en pièce jointe JSON, CSV ou HTML (transcript visuel complet : embeds, pièces jointes, avatars).',
    category: 'utility',
    paramsSchema: z.object({
      channelId: z.string().min(1),
      format: z.enum(['json', 'csv', 'html']).default('json'),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    requiredModules: [],
    permissions: ['ManageMessages'],
    destructive: false,
    systemPrompt:
      'Le fichier part automatiquement en pièce jointe dans le salon de la demande. HTML = transcript visuel (tickets, archives) ; JSON/CSV = données brutes.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { channelId, format, limit } = input as { channelId: string; format?: 'json' | 'csv' | 'html'; limit?: number };
      const channel = resolver.textChannel(ctx.guildId, channelId);
      if (!channel) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
      const messages = await channel.messages.fetch({ limit: limit ?? 100 }).catch(() => null);
      if (!messages || messages.size === 0) return { ok: false, summary: 'Salon vide.' };
      const ordered = [...messages.values()].reverse();
      // HTML : discord-html-transcripts (embeds, attachments, avatars,
      // markdown rendus — le standard discord.js pour les transcripts).
      if ((format ?? 'json') === 'html') {
        const attachment = await generateFromMessages(ordered, channel, { returnType: ExportReturnType.Buffer });
        const sent = await ctx
          .sendFile?.({ name: `transcript-${channel.name}.html`, attachment })
          .then(() => true)
          .catch(() => false);
        return sent
          ? { ok: true, summary: `Transcript HTML de ${ordered.length} message(s) envoyé en pièce jointe.` }
          : { ok: false, summary: 'Transcript généré mais envoi impossible (surface sans fichiers).' };
      }
      const rows = ordered.map((message) => ({
        date: new Date(message.createdTimestamp).toISOString(),
        author: message.author.username,
        content: message.content,
      }));
      let payload: string;
      let name: string;
      if ((format ?? 'json') === 'csv') {
        const escape = (value: string): string => `"${value.replaceAll('"', '""')}"`;
        payload = ['date,author,content', ...rows.map((row) => `${row.date},${escape(row.author)},${escape(row.content)}`)].join('\n');
        name = `export-${channel.name}.csv`;
      } else {
        payload = JSON.stringify(rows, null, 2);
        name = `export-${channel.name}.json`;
      }
      const sent = await ctx
        .sendFile?.({ name, attachment: Buffer.from(payload, 'utf8') })
        .then(() => true)
        .catch(() => false);
      return sent
        ? { ok: true, summary: `Export de ${rows.length} message(s) envoyé en pièce jointe (${name}).` }
        : { ok: false, summary: 'Export généré mais envoi impossible (surface sans fichiers).' };
    },
  };
}

/** Tool members.export : exporte l'annuaire des membres en pièce jointe JSON. */
export function membersExportTool(deps: UtilityToolsDeps): BotTool {
  const { resolver } = deps;
  return {
    name: 'members.export',
    description: 'Exporte l\u0027annuaire des membres (nom, join date, rôles) en JSON.',
    category: 'utility',
    paramsSchema: z.object({ limit: z.number().int().min(1).max(1000).default(200) }),
    requiredModules: [],
    permissions: ['ManageGuild'],
    destructive: false,
    systemPrompt: 'Fichier joint automatiquement dans le salon de la demande.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const guild = resolver.guildOf(ctx);
      if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { limit } = input as { limit?: number };
      const members = await guild.members.fetch().catch(() => null);
      if (!members) return { ok: false, summary: 'Fetch des membres impossible.' };
      const rows = members
        .map((member: GuildMember) => ({
          username: member.user.username,
          joinedAt: member.joinedAt?.toISOString() ?? null,
          roles: member.roles.cache.filter((role) => role.id !== guild.id).map((role) => role.name),
        }))
        .slice(0, limit ?? 200);
      const payload = JSON.stringify(rows, null, 2);
      await ctx.sendFile?.({ name: `membres-${guild.name.replaceAll(/\W+/gu, '-')}.json`, attachment: Buffer.from(payload, 'utf8') }).catch(() => {});
      return { ok: true, summary: `Annuaire de ${rows.length} membre(s) exporté en pièce jointe.` };
    },
  };
}
