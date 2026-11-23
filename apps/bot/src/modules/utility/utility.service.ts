import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import {
  ChannelType,
  Client,
  Events,
  PermissionFlagsBits,
  type GuildMember,
} from 'discord.js';
import { z } from 'zod';
import { generateFromMessages, ExportReturnType } from 'discord-html-transcripts';
import type { BotTool, ToolResult } from '@10cordes/shared';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Utilities roundup : exports (messages/membres), recherche d'historique,
 * événements Discord natifs, posts forum/fils, pins, annonces webhook,
 * réactions. Tools indépendants, tous permission-gated.
 */
@Injectable()
export class UtilityService implements SpraxiumOnBoot {
  private readonly log = new Logger('Utility');

  constructor(
    private readonly client: Client,
    private readonly prisma: PrismaService,
  ) {}

  onBoot(): void {
    for (const tool of this.buildTools()) getToolRegistry().register(tool);
    this.log.info(`${this.buildTools().length} tools utility enregistrés.`);
  }

  private guildOf(ctx: { guildId: string | null }) {
    return ctx.guildId ? (this.client.guilds.cache.get(ctx.guildId) ?? null) : null;
  }

  private textChannel(guildId: string, channelId: string) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return null;
    const channel = guild.channels.cache.get(channelId);
    return channel && channel.isTextBased() && !channel.isDMBased() ? channel : null;
  }

  private buildTools(): BotTool[] {
    return [
      {
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
          const channel = this.textChannel(ctx.guildId, channelId);
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
      },
      {
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
          const channel = this.textChannel(ctx.guildId, channelId);
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
      },
      {
        name: 'members.export',
        description: 'Exporte l\u0029annuaire des membres (nom, join date, rôles) en JSON.',
        category: 'utility',
        paramsSchema: z.object({ limit: z.number().int().min(1).max(1000).default(200) }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Fichier joint automatiquement dans le salon de la demande.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const guild = this.guildOf(ctx);
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
      },
      {
        name: 'event.schedule',
        description: 'Crée un événement Discord planifié natif (visible dans l\u0029onglet Événements du serveur).',
        category: 'utility',
        paramsSchema: z.object({
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
          startAtIso: z.string().min(1),
          durationMinutes: z.number().int().min(15).max(1440).default(60),
          locationChannelId: z.string().optional().describe('Salon vocal de l\u0029événement (optionnel)'),
        }),
        requiredModules: [],
        permissions: ['ManageEvents'],
        destructive: false,
        systemPrompt: 'Événement natif Discord : il apparaît dans l\u0029onglet dédié. Convertis la date en ISO.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const guild = this.guildOf(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { name, description, startAtIso, durationMinutes, locationChannelId } = input as {
            name: string;
            description?: string;
            startAtIso: string;
            durationMinutes?: number;
            locationChannelId?: string;
          };
          const start = new Date(startAtIso);
          if (Number.isNaN(start.getTime())) return { ok: false, summary: 'Date ISO invalide.' };
          const end = new Date(start.getTime() + (durationMinutes ?? 60) * 60_000);
          const event = locationChannelId
            ? await guild.scheduledEvents
                .create({
                  name,
                  description,
                  scheduledStartTime: start,
                  scheduledEndTime: end,
                  entityType: 2,
                  channel: locationChannelId,
                  privacyLevel: 2,
                })
                .catch(() => null)
            : await guild.scheduledEvents
                .create({
                  name,
                  description,
                  scheduledStartTime: start,
                  scheduledEndTime: end,
                  entityType: 3,
                  privacyLevel: 2,
                  entityMetadata: { location: 'En ligne' },
                })
                .catch(() => null);
          if (!event) return { ok: false, summary: 'Création impossible (permissions ManageEvents ?).' };
          return { ok: true, summary: `Événement **${name}** planifié (<t:${Math.floor(start.getTime() / 1000)}:R>).` };
        },
      },
      {
        name: 'forum.post',
        description: 'Crée un post dans un salon forum (titre + message de démarrage).',
        category: 'utility',
        paramsSchema: z.object({
          channelId: z.string().min(1).describe('ID du salon forum'),
          title: z.string().min(1).max(100),
          content: z.string().min(1).max(2000),
        }),
        requiredModules: [],
        permissions: ['ManageThreads'],
        destructive: false,
        systemPrompt: 'Le salon cible doit être un forum.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const guild = this.guildOf(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { channelId, title, content } = input as { channelId: string; title: string; content: string };
          const channel = guild.channels.cache.get(channelId);
          if (!channel || channel.type !== ChannelType.GuildForum) return { ok: false, summary: 'Salon introuvable ou pas un forum.' };
          const me = guild.members.me;
          if (!me?.permissions.has(PermissionFlagsBits.CreatePublicThreads)) {
            return { ok: false, summary: "Le bot n'a pas la permission CreatePublicThreads." };
          }
          const thread = await channel.threads.create({ name: title.slice(0, 100), message: { content: content.slice(0, 2000) } }).catch(() => null);
          if (!thread) return { ok: false, summary: 'Création du post impossible (permissions ?).' };
          return { ok: true, summary: `Post « ${title} » créé : <#${thread.id}>` };
        },
      },
      {
        name: 'thread.create',
        description: 'Crée un fil sous un message existant.',
        category: 'utility',
        paramsSchema: z.object({
          channelId: z.string().min(1),
          messageId: z.string().min(1),
          name: z.string().min(1).max(100),
        }),
        requiredModules: [],
        permissions: ['ManageThreads'],
        destructive: false,
        systemPrompt: 'Fil de discussion ancré sur un message.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const guild = this.guildOf(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { channelId, messageId, name } = input as { channelId: string; messageId: string; name: string };
          const channel = this.textChannel(ctx.guildId, channelId);
          if (!channel || channel.isThread() || channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
            return { ok: false, summary: 'Salon introuvable ou non textuel.' };
          }
          const thread = await channel.threads
            .create({ name: name.slice(0, 100), startMessage: messageId })
            .catch(() => null);
          if (!thread) return { ok: false, summary: 'Création du fil impossible (message introuvable ou permissions ?).' };
          return { ok: true, summary: `Fil « ${name} » créé : <#${thread.id}>` };
        },
      },
      {
        name: 'message.pin',
        description: 'Épingle un message dans un salon.',
        category: 'utility',
        paramsSchema: z.object({ channelId: z.string().min(1), messageId: z.string().min(1) }),
        requiredModules: [],
        permissions: ['ManageMessages'],
        destructive: false,
        systemPrompt: 'Épinglage simple.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const channel = this.textChannel(ctx.guildId, (input as { channelId: string }).channelId);
          if (!channel) return { ok: false, summary: 'Salon introuvable.' };
          const pinned = await channel.messages.pin((input as { messageId: string }).messageId).then(() => true).catch(() => false);
          return pinned
            ? { ok: true, summary: 'Message épinglé.' }
            : { ok: false, summary: 'Épinglage impossible (message introuvable ou permissions ?).' };
        },
      },
      {
        name: 'message.unpin',
        description: 'Désépingle un message.',
        category: 'utility',
        paramsSchema: z.object({ channelId: z.string().min(1), messageId: z.string().min(1) }),
        requiredModules: [],
        permissions: ['ManageMessages'],
        destructive: false,
        systemPrompt: 'Désépinglage simple.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const channel = this.textChannel(ctx.guildId, (input as { channelId: string }).channelId);
          if (!channel) return { ok: false, summary: 'Salon introuvable.' };
          const unpinned = await channel.messages.unpin((input as { messageId: string }).messageId).then(() => true).catch(() => false);
          return unpinned
            ? { ok: true, summary: 'Message désépinglé.' }
            : { ok: false, summary: 'Désépinglage impossible (message introuvable ou permissions ?).' };
        },
      },
      {
        name: 'webhook.post',
        description: 'Poste une annonce via webhook dans un salon (nom + avatar personnalisés). Réservé aux annonces officielles.',
        category: 'utility',
        paramsSchema: z.object({
          channelId: z.string().min(1),
          name: z.string().min(1).max(80),
          content: z.string().min(1).max(1500),
          avatarUrl: z.string().url().max(500).optional(),
        }),
        requiredModules: [],
        permissions: ['ManageWebhooks'],
        destructive: false,
        systemPrompt:
          'Uniquement pour des annonces de staff explicites. JAMAIS d\u0027impersonation d\u0027un vrai membre (confusion de confiance).',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const channel = this.textChannel(ctx.guildId, (input as { channelId: string }).channelId);
          if (!channel || channel.isThread()) return { ok: false, summary: 'Salon introuvable.' };
          const { name, content, avatarUrl } = input as { name: string; content: string; avatarUrl?: string };
          const hooks = await channel.fetchWebhooks().catch(() => null);
          const existing = hooks ? [...hooks.values()].find((h) => h.name === 'agent-annonces' && h.channelId === channel.id) : undefined;
          let hook = existing;
          if (!hook) {
            hook = await channel.createWebhook({ name: 'agent-annonces', avatar: avatarUrl, reason: 'annonces agent' }).catch(() => undefined);
          }
          if (!hook) return { ok: false, summary: 'Création du webhook impossible (permissions ManageWebhooks ?).' };
          const sent = await hook.send({ content: content.slice(0, 1500), username: name.slice(0, 80), avatarURL: avatarUrl }).then(() => true).catch(() => false);
          return sent
            ? { ok: true, summary: 'Annonce postée via webhook.' }
            : { ok: false, summary: "Envoi via webhook échoué (permissions du salon, contenu rejeté ?)." };
        },
      },
      {
        name: 'thread.addMember',
        description: 'Ajoute un membre à un fil (les fils PRIVÉS exigent un ajout explicite : ceci est la primitive des systèmes de tickets par threads).',
        category: 'utility',
        paramsSchema: z.object({ threadId: z.string().min(1), userId: z.string().min(1) }),
        requiredModules: [],
        permissions: [],
        destructive: false,
        systemPrompt: "Read-before-write : vérifie via getMembers que le membre existe. Le bot doit être membre du fil pour y ajouter quelqu'un.",
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { threadId, userId } = input as { threadId: string; userId: string };
          const thread = await this.client.channels.fetch(threadId).catch(() => null);
          if (!thread?.isThread()) return { ok: false, summary: 'Fil introuvable.' };
          const added = await thread.members.add(userId).then(() => true).catch(() => false);
          return added
            ? { ok: true, summary: `<@${userId}> ajouté au fil <#${threadId}>.` }
            : { ok: false, summary: "Ajout impossible (membre introuvable, déjà membre, ou bot hors du fil ?)." };
        },
      },
      {
        name: 'message.crosspost',
        description: 'Crosspost (publie) un message d\u2019un salon d\u2019annonces vers tous les serveurs qui le suivent.',
        category: 'utility',
        paramsSchema: z.object({ channelId: z.string().min(1), messageId: z.string().min(1) }),
        requiredModules: [],
        permissions: ['ManageMessages'],
        destructive: false,
        systemPrompt: 'Fonctionne uniquement dans un salon de type ANNONCES (NewsChannel). Sinon Discord refuse.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { channelId, messageId } = input as { channelId: string; messageId: string };
          const channel = this.textChannel(ctx.guildId, channelId);
          if (!channel || channel.type !== ChannelType.GuildAnnouncement) {
            return { ok: false, summary: 'Le crosspost exige un salon de type Annonces.' };
          }
          const message = await channel.messages.fetch(messageId).catch(() => null);
          if (!message) return { ok: false, summary: 'Message introuvable.' };
          const crossposted = await message.crosspost().then(() => true).catch(() => false);
          return crossposted
            ? { ok: true, summary: 'Message publié (crosspost) vers les serveurs abonnés.' }
            : { ok: false, summary: 'Crosspost refusé (déjà publié ou rate-limit).' };
        },
      },
      {
        name: 'reaction.add',
        description: 'Ajoute une réaction emoji à un message.',
        category: 'utility',
        paramsSchema: z.object({ channelId: z.string().min(1), messageId: z.string().min(1), emoji: z.string().min(1).max(32) }),
        requiredModules: [],
        permissions: ['AddReactions'],
        destructive: false,
        systemPrompt: 'Emoji en format unicode ou <:nom:id>.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const channel = this.textChannel(ctx.guildId, (input as { channelId: string }).channelId);
          if (!channel) return { ok: false, summary: 'Salon introuvable.' };
          const { messageId, emoji } = input as { messageId: string; emoji: string };
          const message = await channel.messages.fetch(messageId).catch(() => null);
          if (!message) return { ok: false, summary: 'Message introuvable.' };
          const reacted = await message.react(emoji).then(() => true).catch(() => false);
          return reacted
            ? { ok: true, summary: `Réaction ${emoji} ajoutée.` }
            : { ok: false, summary: `Réaction ${emoji} impossible (emoji invalide ou permissions ?).` };
        },
      },
    ];
  }
}
