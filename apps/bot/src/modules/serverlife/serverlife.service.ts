import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { randomInt } from 'node:crypto';
import {
  ChannelType,
  Client,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type Message,
  type VoiceState,
} from 'discord.js';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { BotTool, ToolResult } from '@10cordes/shared';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { describeCoverage } from './activity-coverage';

/**
 * Vie de serveur : petits tools à haute valeur, tous permission-gated.
 * - snipe : derniers messages supprimés/édités (cache mémoire, staff-only)
 * - AFK : statut par membre, réponse auto à la mention
 * - anniversaires : table + annonce quotidienne au sweep du boot
 * - sticky roles : rôles ré-attribués au retour d'un membre
 * - lockdown/dehoist : outils anti-raid d'urgence
 * - voice.activity : lance les activités Discord officielles (chess, poker...)
 * - sanctions temporaires : tempmute/tempban/temprole auto-révoqués (sweep boot)
 * - trust score : dérivé des cases de modération avec décroissance (jamais stocké :
 *   calculé depuis les cases = idempotent par construction)
 * - activité membre : comptage messages/minutes vocal → rank/top
 */

// Symboles ASCII hoistables + espaces insécables, écrits en échappements
// unicode purs (aucun caractère littéral ambigu dans la classe).
const HOIST_CHARS = /^[\u00a0\u200b-\u200d\u2060\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007f\s]+/u;

interface SnipeEntry {
  author: string;
  content: string;
  action: 'deleted' | 'edited';
  at: number;
}

@Injectable()
export class ServerlifeService implements SpraxiumOnBoot {
  private readonly log = new Logger('Serverlife');
  private readonly snipes = new Map<string, SnipeEntry[]>();
  private readonly lockedChannels = new Map<string, Set<string>>();
  private readonly activityBuffer = new Map<string, number>(); // clé guildId:userId -> delta messages
  private flushTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly client: Client,
    private readonly prisma: PrismaService,
    private readonly config: GuildConfigService,
  ) {}

  onBoot(): void {
    const tools = this.buildTools();
    for (const tool of tools) getToolRegistry().register(tool);
    this.log.info(`${tools.length} tools vie de serveur enregistrés.`);
    void this.sweepTempSanctions();
    void this.announceBirthdays();
    // Flush périodique du buffer d'activité (60s).
    this.flushTimer = setInterval(() => void this.flushActivity(), 60_000);
    this.flushTimer.unref?.();
    // Sweeps périodiques (bug fix : ils ne tournaient qu'au BOOT — une
    // sanction expirée pendant l'uptime n'était révoquée qu'au restart, et
    // les anniversaires n'étaient annoncés que si le bot redémarrant le
    // jour J).
    this.sweepTimer = setInterval(() => {
      void this.sweepTempSanctions();
      void this.announceBirthdays();
    }, 5 * 60_000);
    this.sweepTimer.unref?.();
  }

  // ── Helpers ─────────────────────────────────────────────────

  /** Capture un message supprimé/édité pour le tool snipe (ring buffer 25/salon). */
  captureSnipe(message: Message, action: 'deleted' | 'edited', newContent?: string): void {
    // Les messages partiels (hors cache après restart) n'ont pas d'author :
    // ignorer plutôt que crasher (fix du crash « Cannot read null.bot »).
    if (!message.guildId || !message.author || message.author.bot) return;
    if (action === 'edited' && !message.content) return;
    const buffer = this.snipes.get(message.channelId) ?? [];
    buffer.push({
      author: message.author.username,
      content: (action === 'edited' ? `avant : ${message.content} → après : ${newContent ?? ''}` : message.content) || '(sans texte)',
      action,
      at: Date.now(),
    });
    if (buffer.length > 25) buffer.shift();
    this.snipes.set(message.channelId, buffer);
  }

  /** Incrémente le compteur de messages (buffer mémoire, flush 60s). */
  countMessage(guildId: string, userId: string): void {
    const key = `${guildId}:${userId}`;
    this.activityBuffer.set(key, (this.activityBuffer.get(key) ?? 0) + 1);
  }

  private guildOf(ctx: { guildId: string | null }): Guild | null {
    return ctx.guildId ? (this.client.guilds.cache.get(ctx.guildId) ?? null) : null;
  }

  private parseHoist(name: string): string | null {
    const match = name.match(HOIST_CHARS);
    return match ? match[0] : null;
  }

  /**
   * Score de confiance (0-1000) : 1000 moins la somme pondérée des sanctions,
   * chaque sanction décroissant exponentiellement (demi-vie 30 jours :
   * facteur Math.exp(-0.0231 * jours), 0.0231 = ln(2)/30).
   */
  private trustScore(cases: Array<{ action: string; createdAt: Date }>): number {
    const weights: Record<string, number> = {
      warn: 40,
      timeout: 120,
      kick: 200,
      ban: 400,
      derank: 150,
    };
    let penalty = 0;
    const now = Date.now();
    for (const modCase of cases) {
      const weight = weights[modCase.action] ?? 60;
      const daysAgo = (now - modCase.createdAt.getTime()) / 86_400_000;
      penalty = penalty + weight * Math.exp(-0.0231 * daysAgo);
    }
    const raw = 1000 - penalty;
    return Math.max(0, Math.min(1000, Math.round(raw)));
  }

  private async flushActivity(): Promise<void> {
    if (this.activityBuffer.size === 0) return;
    const entries = [...this.activityBuffer.entries()];
    this.activityBuffer.clear();
    for (const [key, delta] of entries) {
      const parts = key.split(':');
      const guildId = parts[0];
      const userId = parts[1];
      await this.prisma.memberActivity
        .upsert({
          where: { guildId_userId: { guildId, userId } },
          create: { guildId, userId, messages: delta },
          update: { messages: { increment: delta } },
        })
        .catch(() => {});
    }
  }

  // ── Sweeps ──────────────────────────────────────────────────

  /** Révoque les sanctions temporaires échues (timeout déjà géré par Discord). */
  private async sweepTempSanctions(): Promise<void> {
    const due = await this.prisma.tempSanction.findMany({ where: { done: false, revokeAt: { lte: new Date() } } });
    for (const sanction of due) {
      try {
        const guild = this.client.guilds.cache.get(sanction.guildId);
        if (guild) {
          const member = await guild.members.fetch(sanction.userId).catch(() => null);
          if (sanction.type === 'ban') {
            await guild.members.unban(sanction.userId, 'sanction temporaire expirée').catch(() => {});
          } else if (sanction.type === 'kick') {
            // Gate de vérification : kick AT revokeAt (le timer a pu mourir avec un crash).
            const pendingMember = await guild.members.fetch(sanction.userId).catch(() => null);
            if (pendingMember) await pendingMember.kick('non vérifié à temps (gate de vérification)').catch(() => {});
          } else if (sanction.type === 'role' && member) {
            const payload = JSON.parse(sanction.payload || '{}') as { roleId?: string };
            if (payload.roleId) await member.roles.remove(payload.roleId, 'sanction temporaire expirée').catch(() => {});
          } else if (sanction.type === 'timeout' && member) {
            await member.timeout(null, 'sanction temporaire expirée').catch(() => {});
          }
        }
        await this.prisma.tempSanction.update({ where: { id: sanction.id }, data: { done: true } });
      } catch (error) {
        this.log.warn(`Révocation échouée (${sanction.type} ${sanction.userId}) : ${(error as Error).message.slice(0, 80)}`);
      }
    }
  }

  /** Annonce les anniversaires du jour dans le salon système (une fois par jour local). */
  private lastBirthdayDay = '';
  private async announceBirthdays(): Promise<void> {
    // Date LOCALE (fr-CA => YYYY-MM-DD) : toISOString découpait en UTC et
    // décalait les anniversaires selon le fuseau.
    const mmdd = new Date().toLocaleDateString('fr-CA').slice(5, 10);
    if (mmdd === this.lastBirthdayDay) return; // déjà annoncé aujourd'hui
    const today = await this.prisma.memberBirthday.findMany({ where: { date: mmdd } });
    this.lastBirthdayDay = mmdd;
    for (const birthday of today) {
      const guild = this.client.guilds.cache.get(birthday.guildId);
      const target = guild?.systemChannelId ?? null;
      if (!guild || !target) continue;
      const channel = guild.channels.cache.get(target);
      if (channel?.isTextBased()) {
        await channel
          .send({ content: `🎂 C'est l'anniversaire de <@${birthday.userId}> aujourd'hui ! Joyeux anniversaire.` })
          .catch(() => {});
      }
    }
  }

  // ── Tools ───────────────────────────────────────────────────

  private buildTools(): BotTool[] {
    return [
      {
        name: 'snipe',
        description: 'Montre les derniers messages supprimés ou édités d\u0027un salon (cache mémoire, réservé au staff).',
        category: 'serverlife',
        paramsSchema: z.object({ channelId: z.string().min(1).optional() }),
        requiredModules: [],
        permissions: ['ManageMessages'],
        destructive: false,
        systemPrompt: 'Outil d\u0027investigation de modération : montre ce qui a été effacé/modifié récemment.',
        handler: async (input, ctx) => {
          const guild = this.guildOf(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { channelId } = input as { channelId?: string };
          const target = channelId ?? ctx.channelId;
          if (!target) return { ok: false, summary: 'Salon introuvable.' };
          const entries = this.snipes.get(target) ?? [];
          if (entries.length === 0) return { ok: true, summary: 'Aucun message supprimé/édité en mémoire pour ce salon.' };
          const lines = entries.slice(-5).map((entry) => `[${entry.author} · ${entry.action}] : ${entry.content.slice(0, 120)}`);
          return { ok: true, summary: `Derniers effacements : ${lines.join(' | ')}` };
        },
      },
      {
        name: 'members.pickRandom',
        description:
          'Tirage aléatoire de membres : parmi les réactants 🎉 d\u0027un message, les membres d\u0027un rôle, ou tout le serveur. La primitive des tirages au sort composés (giveaways, quiz...).',
        category: 'serverlife',
        paramsSchema: z.object({
          scope: z.enum(['reactors', 'role', 'all']).default('all'),
          sourceId: z.string().optional().describe('scope=reactors : ID du message ; scope=role : ID du rôle'),
          count: z.number().int().min(1).max(20).default(1),
          excludeBots: z.boolean().default(true),
        }),
        requiredModules: [],
        destructive: false,
        systemPrompt:
          'Pour les tirages au sort composés : crée d\u0027abord une surface (surface.create) avec un bouton Participer dont le pipeline écrit dans la collection component_votes (record.write), liste les participants avec records.search, puis ce tool pour tirer. Exclut toujours les bots.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const guild = this.guildOf(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { scope, sourceId, count, excludeBots } = input as {
            scope?: 'reactors' | 'role' | 'all';
            sourceId?: string;
            count?: number;
            excludeBots?: boolean;
          };
          const take = count ?? 1;
          let candidates: string[] = [];
          let candidatesPartial = false;
          if (scope === 'reactors') {
            if (!sourceId) return { ok: false, summary: 'scope=reactors exige sourceId (ID du message).' };
            const channelId = ctx.channelId ?? '';
            const channel = this.client.channels.cache.get(channelId);
            if (!channel || !('messages' in channel)) return { ok: false, summary: 'Salon introuvable.' };
            const message = await channel.messages.fetch(sourceId).catch(() => null);
            if (!message) return { ok: false, summary: 'Message introuvable.' };
            for (const reaction of message.reactions.cache.values()) {
              const users = await reaction.users.fetch().catch(() => null);
              if (!users) continue;
              for (const user of users.values()) {
                if (excludeBots && (user.bot || user.id === this.client.user?.id)) continue;
                if (!candidates.includes(user.id)) candidates.push(user.id);
              }
            }
          } else {
            // guild.members.fetch() exige l'intent privilégié GuildMembers :
            // sans lui on replie sur le cache (membres déjà vus par le bot) au
            // lieu d'échouer, et le résultat dit que la liste est partielle.
            const fetched = await guild.members.fetch().catch(() => null);
            const members: GuildMember[] = fetched ? [...fetched.values()] : [...guild.members.cache.values()];
            const partial = fetched === null;
            candidates = members
              .filter((member) => {
                if (member.user?.bot) return false;
                if (scope === 'role' && sourceId) return member.roles.cache.has(sourceId);
                return true;
              })
              .map((member) => member.id);
            if (partial && candidates.length > 0) {
              candidatesPartial = true;
            }
          }
          const partialNote = candidatesPartial
            ? ' Connus du bot uniquement (liste des membres incomplète : active l\u0027intent privilégié « Membres du serveur » pour un tirage sur tous les membres).'
            : '';
          if (candidates.length === 0) {
            return {
              ok: false,
              summary: `Aucun candidat pour ce tirage (scope=${scope}${sourceId ? `, source ${sourceId}` : ''}).${partialNote}`,
            };
          }
          const winners: string[] = [];
          const pool = [...candidates];
          for (let i = 0; i < take && pool.length > 0; i += 1) {
            const index = randomInt(0, pool.length);
            winners.push(pool[index]);
            pool.splice(index, 1);
          }
          return {
            ok: true,
            summary:
              `Tirage parmi ${candidates.length} candidat(s) : ${winners.map((id) => `<@${id}>`).join(', ')}.${partialNote} ` +
              'Annonce les gagnants en UNE phrase (ne répète pas les conditions).',
            data: { winners, candidates: candidates.length, partial: candidatesPartial },
          };
        },
      },
      {
        name: 'afk.set',
        description: 'Passe un membre en AFK avec raison : à son retour ou quand on le mentionne, le bot l\u0027explique.',
        category: 'serverlife',
        paramsSchema: z.object({
          reason: z.string().min(2).max(200).default('absent'),
          userId: z.string().min(1).optional().describe('Par défaut soi-même'),
        }),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'L\u0027utilisateur peut se mettre AFK lui-même ; un staff peut le faire pour quelqu\u0027un.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { reason, userId } = input as { reason?: string; userId?: string };
          const target = userId ?? ctx.userId;
          await this.prisma.afkStatus.upsert({
            where: { guildId_userId: { guildId: ctx.guildId, userId: target } },
            create: { guildId: ctx.guildId, userId: target, reason: reason ?? 'absent' },
            update: { reason: reason ?? 'absent', since: new Date() },
          });
          return { ok: true, summary: `<@${target}> est maintenant AFK (${reason ?? 'absent'}).` };
        },
      },
      {
        name: 'afk.clear',
        description: 'Retire le statut AFK d\u0027un membre.',
        category: 'serverlife',
        paramsSchema: z.object({ userId: z.string().min(1).optional().describe('Par défaut soi-même') }),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Retour de vacances ou erreur.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { userId } = input as { userId?: string };
          const target = userId ?? ctx.userId;
          await this.prisma.afkStatus.deleteMany({ where: { guildId: ctx.guildId, userId: target } });
          return { ok: true, summary: `<@${target}> n\u0027est plus AFK.` };
        },
      },
      {
        name: 'birthday.set',
        description: 'Enregistre un anniversaire (format MM-DD) : annoncé dans le salon système le jour J.',
        category: 'serverlife',
        paramsSchema: z.object({
          date: z.string().regex(/^\d{2}-\d{2}$/u, 'Format MM-DD'),
          userId: z.string().min(1).optional().describe('Par défaut soi-même'),
        }),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Format strict MM-DD (ex : 07-14). Le jour J, le bot annonce dans le salon système.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { date, userId } = input as { date: string; userId?: string };
          const target = userId ?? ctx.userId;
          await this.prisma.memberBirthday.upsert({
            where: { guildId_userId: { guildId: ctx.guildId, userId: target } },
            create: { guildId: ctx.guildId, userId: target, date },
            update: { date },
          });
          return { ok: true, summary: `Anniversaire de <@${target}> enregistré : ${date}.` };
        },
      },
      {
        name: 'birthday.list',
        description: 'Liste les anniversaires du serveur (triés par date).',
        category: 'serverlife',
        paramsSchema: z.object({}),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Read-only.',
        handler: async (_input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const rows = await this.prisma.memberBirthday.findMany({
            where: { guildId: ctx.guildId },
            orderBy: { date: 'asc' },
          });
          if (rows.length === 0) return { ok: true, summary: 'Aucun anniversaire enregistré.' };
          const lines = rows.map((row) => `${row.date} → <@${row.userId}>`);
          return { ok: true, summary: `${rows.length} anniversaire(s) : ${lines.join(' | ')}` };
        },
      },
      {
        name: 'sticky.role.add',
        description: 'Rend un rôle sticky pour un membre : ré-attribué automatiquement à son retour sur le serveur.',
        category: 'serverlife',
        paramsSchema: z.object({ roleId: z.string().min(1), userId: z.string().min(1).optional() }),
        requiredModules: [],
        permissions: ['ManageRoles'],
        destructive: false,
        systemPrompt: 'Sticky = persiste même après un leave/rejoin.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { roleId, userId } = input as { roleId: string; userId?: string };
          const target = userId ?? ctx.userId;
          await this.prisma.stickyRole.upsert({
            where: { guildId_userId_roleId: { guildId: ctx.guildId, userId: target, roleId } },
            create: { guildId: ctx.guildId, userId: target, roleId },
            update: {},
          });
          return { ok: true, summary: `Rôle <@&${roleId}> rendu sticky pour <@${target}>.` };
        },
      },
      {
        name: 'sticky.role.remove',
        description: 'Retire un rôle sticky d\u0027un membre.',
        category: 'serverlife',
        paramsSchema: z.object({ roleId: z.string().min(1), userId: z.string().min(1).optional() }),
        requiredModules: [],
        permissions: ['ManageRoles'],
        destructive: false,
        systemPrompt: 'Arrête la ré-attribution automatique.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { roleId, userId } = input as { roleId: string; userId?: string };
          const target = userId ?? ctx.userId;
          await this.prisma.stickyRole.deleteMany({ where: { guildId: ctx.guildId, userId: target, roleId } });
          return { ok: true, summary: `Rôle <@&${roleId}> n\u0027est plus sticky pour <@${target}>.` };
        },
      },
      {
        name: 'voice.activity',
        description:
          'Lance une activité Discord officielle dans le vocal courant : chess, poker, watch (YouTube), betrayal, fishing, letter-tile, word-snack.',
        category: 'serverlife',
        paramsSchema: z.object({
          activity: z.enum(['chess', 'poker', 'watch', 'betrayal', 'fishing', 'letter-tile', 'word-snack']),
        }),
        requiredModules: [],
        destructive: false,
        systemPrompt:
          'Demande à l\u0027utilisateur d\u0027être en vocal, ou indique-le. L\u0027invitation s\u0027affiche dans le vocal ; l\u0027utilisateur clique pour lancer.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { activity } = input as { activity: string };
          const ids: Record<string, string> = {
            chess: '879863976203456297',
            poker: '755827207812677713',
            watch: '880218394199220332',
            betrayal: '773336526917861400',
            fishing: '814288819473020965',
            'letter-tile': '879863681317009951',
            'word-snack': '87986407010126432',
          };
          const appId = ids[activity];
          const guild = this.guildOf(ctx);
          const member = guild ? await guild.members.fetch(ctx.userId).catch(() => null) : null;
          const voiceChannel = member?.voice.channel ?? null;
          if (!voiceChannel) return { ok: false, summary: 'Tu n\u0027es pas en vocal : rejoins un vocal puis redemande.' };
          const invite = await voiceChannel
            .createInvite({ targetApplication: appId, targetType: 2, maxAge: 86_400 })
            .catch(() => null);
          if (!invite) return { ok: false, summary: 'Impossible de créer l\u0027invitation d\u0027activité (permissions ?).' };
          return { ok: true, summary: `Activité **${activity}** prête : ${invite.url}` };
        },
      },
      {
        name: 'lockdown',
        description:
          'Verrouille (ou déverrouille) instantanément les salons texte du serveur : deny/restore SendMessages à @everyone. Outil anti-raid.',
        category: 'serverlife',
        paramsSchema: z.object({
          action: z.enum(['lock', 'unlock']),
          scope: z.enum(['all', 'category']).default('all'),
          categoryId: z.string().optional().describe('Si scope=category'),
        }),
        requiredModules: [],
        permissions: ['ManageChannels', 'ManageRoles'],
        destructive: true,
        systemPrompt:
          'OUTIL D\u0027URGENCE anti-raid. lock : deny SendMessages partout ; unlock : restaure exactement l\u0027état pré-lock (mémorisé en mémoire).',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const guild = this.guildOf(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { action, scope, categoryId } = input as { action: 'lock' | 'unlock'; scope?: 'all' | 'category'; categoryId?: string };
          const channels = [...guild.channels.cache.values()].filter(
            (channel) => channel.type === ChannelType.GuildText && (!categoryId || channel.parentId === categoryId),
          );
          if (channels.length === 0) return { ok: false, summary: 'Aucun salon texte à traiter.' };
          let touched = 0;
          if (action === 'lock') {
            const previouslyOpen = channels.filter((channel) => {
              const everyone = (channel as import('discord.js').GuildChannel).permissionOverwrites.cache.get(guild.id);
              return everyone ? !everyone.deny.has(PermissionFlagsBits.SendMessages) : true;
            });
            for (const channel of channels) {
              await (channel as import('discord.js').GuildChannel)
                .permissionOverwrites.edit(guild.id, { SendMessages: false }, { reason: 'lockdown' })
                .catch(() => {});
            }
            this.lockedChannels.set(ctx.guildId, new Set(previouslyOpen.map((channel) => channel.id)));
            return { ok: true, summary: `Lockdown : ${channels.length} salon(s) verrouillé(s). Unlock pour restaurer l\u0027état pré-lock.` };
          }
          const previouslyOpen = this.lockedChannels.get(ctx.guildId);
          for (const channel of channels) {
            const wasOpen = !previouslyOpen || previouslyOpen.has(channel.id);
            await (channel as import('discord.js').GuildChannel)
              .permissionOverwrites.edit(guild.id, { SendMessages: wasOpen ? true : null }, { reason: 'lockdown release' })
              .catch(() => {});
            touched += 1;
          }
          this.lockedChannels.delete(ctx.guildId);
          return { ok: true, summary: `Unlock : ${touched} salon(s) restauré(s) à l\u0027état pré-lock.` };
        },
      },
      {
        name: 'dehoist',
        description: 'Renomme les pseudos commençant par un caractère hoistable (symboles) avec un préfixe neutre.',
        category: 'serverlife',
        paramsSchema: z.object({ prefix: z.string().min(1).max(6).default('⬇') }),
        requiredModules: [],
        permissions: ['ManageNicknames'],
        destructive: false,
        systemPrompt: 'Anti-hoist : les membres renommés peuvent rechanger leur pseudo ensuite. Rapporte le nombre traité.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const guild = this.guildOf(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { prefix } = input as { prefix?: string };
          const members = await guild.members.fetch().catch(() => null);
          if (!members) return { ok: false, summary: 'Fetch des membres impossible.' };
          let renamed = 0;
          for (const member of members.values()) {
            if (member.user.bot || member.id === guild.ownerId) continue;
            if (!member.manageable) continue;
            const hoist = this.parseHoist(member.displayName);
            if (!hoist) continue;
            await member.setNickname(`${prefix || '⬇'} ${member.user.username}`.slice(0, 32), 'dehoist').catch(() => {});
            renamed += 1;
          }
          return { ok: true, summary: `Dehoist : ${renamed} membre(s) renommé(s).` };
        },
      },
      {
        name: 'member.trust',
        description: 'Score de confiance 0-1000 d\u0027un membre : dérivé de ses cases de modération avec décroissance exponentielle (demi-vie 30 jours).',
        category: 'serverlife',
        paramsSchema: z.object({ userId: z.string().min(1) }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt:
          'Consulte AVANT une décision de modération : score < 400 = historique lourd récent ; score élevé = membre fiable. Calcul dérivé des cases (jamais stocké) : idempotent.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { userId } = input as { userId: string };
          const cases = await this.prisma.modCase.findMany({
            where: { guildId: ctx.guildId, userId },
            select: { action: true, createdAt: true },
          });
          const score = this.trustScore(cases);
          return {
            ok: true,
            summary: `Score de confiance de <@${userId}> : **${score}/1000** (${cases.length} case(s) de modération prisent en compte).`,
            data: { score, cases: cases.length },
          };
        },
      },
      {
        name: 'temp.sanction',
        description:
          'Applique une sanction TEMPORAIRE auto-révoquée : tempmute (timeout Discord), temprole (rôle retiré après), tempban (unban après). Révocation planifiée en DB + sweep toutes les 5 min : survit aux redémarrages et s\'exécute pendant l\'uptime.',
        category: 'serverlife',
        paramsSchema: z.object({
          userId: z.string().min(1),
          type: z.enum(['timeout', 'role', 'ban']),
          durationMinutes: z.number().int().min(1).max(40_320),
          roleId: z.string().optional().describe('Requis si type=role'),
          reason: z.string().max(400).optional(),
        }),
        requiredModules: [],
        permissions: ['ModerateMembers', 'ManageRoles'],
        destructive: true,
        systemPrompt:
          'La révocation est AUTOMATIQUE (sweep périodique) : ne promets jamais de lever la sanction à la main. Consulte member.trust avant si le doute.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const guild = this.guildOf(ctx);
          if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { userId, type, durationMinutes, roleId, reason } = input as {
            userId: string;
            type: 'timeout' | 'role' | 'ban';
            durationMinutes: number;
            roleId?: string;
            reason?: string;
          };
          const member = await guild.members.fetch(userId).catch(() => null);
          // L'action Discord d'abord, avec son échec PROPAGÉ : l'ancien
          // .catch vide créait la ligne de révocation pour une sanction
          // jamais appliquée (réponse « sanction appliquée » mensongère).
          if (type === 'role') {
            if (!roleId) return { ok: false, summary: 'type=role exige roleId.' };
            if (!member) return { ok: false, summary: 'Membre introuvable.' };
            const applied = await member.roles.add(roleId, reason ?? 'sanction temporaire').then(() => true).catch(() => false);
            if (!applied) return { ok: false, summary: 'Ajout du rôle impossible (hiérarchie ou permissions du bot ?).' };
          } else if (type === 'timeout') {
            if (!member) return { ok: false, summary: 'Membre introuvable.' };
            const applied = await member.timeout(durationMinutes * 60_000, reason ?? 'sanction temporaire').then(() => true).catch(() => false);
            if (!applied) return { ok: false, summary: 'Timeout impossible (hiérarchie ou permissions du bot ?).' };
          } else {
            const applied = await guild.members.ban(userId, { reason: reason ?? 'sanction temporaire' }).then(() => true).catch(() => false);
            if (!applied) return { ok: false, summary: 'Ban impossible (hiérarchie ou permissions du bot ?).' };
          }
          const revokeAt = new Date(Date.now() + durationMinutes * 60_000);
          await this.prisma.tempSanction.create({
            data: {
              guildId: ctx.guildId,
              userId,
              type,
              payload: JSON.stringify({ roleId }),
              revokeAt,
              createdBy: ctx.userId,
            },
          });
          return {
            ok: true,
            summary:
              `Sanction temporaire (${type}) appliquée à <@${userId}> pour ${durationMinutes} min. ` +
              `Révocation automatique <t:${Math.floor(revokeAt.getTime() / 1000)}:R>.`,
            data: { revokeAt: revokeAt.toISOString() },
          };
        },
      },
      {
        name: 'member.rank',
        description: 'Rang d\u0027activité d\u0027un membre (messages + temps vocal) sur le serveur.',
        category: 'serverlife',
        paramsSchema: z.object({ userId: z.string().min(1).optional().describe('Par défaut soi-même') }),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Read-only. Activité mesurée depuis l\u0027activation du module.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { userId } = input as { userId?: string };
          const target = userId ?? ctx.userId;
          const me = await this.prisma.memberActivity.findUnique({
            where: { guildId_userId: { guildId: ctx.guildId, userId: target } },
          });
          const all = await this.prisma.memberActivity.findMany({
            where: { guildId: ctx.guildId },
            orderBy: [{ messages: 'desc' }, { voiceMinutes: 'desc' }],
          });
          const rank = all.findIndex((row) => row.userId === target) + 1;
          if (!me) return { ok: true, summary: `<@${target}> : aucune activité enregistrée (rang ${rank || '—'}).` };
          return {
            ok: true,
            summary: `<@${target}> : ${me.messages} message(s), ${me.voiceMinutes} min de vocal — rang ${rank}/${all.length}.`,
            data: { rank, total: all.length },
          };
        },
      },
      {
        name: 'server.top',
        description: 'Top activité du serveur : membres les plus actifs (messages + vocal).',
        category: 'serverlife',
        paramsSchema: z.object({ limit: z.number().int().min(3).max(15).default(10) }),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Read-only. Liste en [PANEL] si demandé publiquement.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { limit } = input as { limit?: number };
          const rows = await this.prisma.memberActivity.findMany({
            where: { guildId: ctx.guildId },
            orderBy: [{ messages: 'desc' }, { voiceMinutes: 'desc' }],
            take: limit ?? 10,
          });
          if (rows.length === 0) return { ok: true, summary: 'Aucune activité enregistrée pour le moment.' };
          const lines = rows.map((row, index) => `${index + 1}. <@${row.userId}> — ${row.messages} msg, ${row.voiceMinutes} min vocal`);
          return { ok: true, summary: `Top activité : ${lines.join(' | ')}` };
        },
      },
      {
        name: 'activity.summary',
        description:
          "Résumé d'activité du serveur en SQL pur (rapide) : volume de messages/jour, joins/leaves, top membres sur la fenêtre (minutes de vocal en cumul), avec coverageSince (date du plus ancien événement compté : indique la profondeur de données réelle). Pour les rapports hebdo et les moyennes/jour.",
        category: 'serverlife',
        paramsSchema: z.object({
          days: z.number().int().min(1).max(90).default(7).describe('Fenêtre en jours (défaut 7)'),
        }),
        requiredModules: [],
        permissions: [],
        destructive: false,
        systemPrompt:
          "Read-only et rapide (SQL agrégé, pas de scan Discord). Cite TOUJOURS coverageSince dans ton rapport : une moyenne/jour n'a de sens que sur la profondeur réelle des données.",
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const days = (input as { days?: number }).days ?? 7;
          const since = new Date(Date.now() - days * 86_400_000);

          // SQL 100% PARAMÉTRÉ (Prisma.sql, jamais de concaténation).
          // Piège SQLite + Prisma : les DateTime sont stockés en epoch-ms
          // ENTIER. strftime ne lit pas cet entier tel quel (il renvoyait
          // NULL : tous les jours se regroupaient sous « null »), d'où le
          // / 1000 + 'unixepoch' ; et MIN("createdAt") ressort en BigInt
          // (new Date(bigint) levait « Cannot convert a BigInt »).
          // 'localtime' : jours du fuseau du processus, cohérents avec toLocalDay.
          const [perDay, coverage, joins, topMembers] = await Promise.all([
            this.prisma.$queryRaw<Array<{ day: string | null; messages: bigint }>>(
              Prisma.sql`SELECT strftime('%Y-%m-%d', "createdAt" / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS messages
                         FROM "audit_logs"
                         WHERE "guildId" = ${ctx.guildId} AND "action" = ${'message.created'} AND "createdAt" >= ${since}
                         GROUP BY day ORDER BY day ASC LIMIT 90`,
            ),
            this.prisma.$queryRaw<Array<{ since: bigint | null }>>(
              Prisma.sql`SELECT MIN("createdAt") AS since FROM "audit_logs"
                         WHERE "guildId" = ${ctx.guildId} AND "action" = ${'message.created'}`,
            ),
            this.prisma.$queryRaw<Array<{ joined: bigint | null; left: bigint | null }>>(
              Prisma.sql`SELECT
                 SUM(CASE WHEN "action" = ${'member.joined'} THEN 1 ELSE 0 END) AS joined,
                 SUM(CASE WHEN "action" = ${'member.left'} THEN 1 ELSE 0 END) AS left
                 FROM "audit_logs"
                 WHERE "guildId" = ${ctx.guildId} AND "action" IN (${'member.joined'}, ${'member.left'}) AND "createdAt" >= ${since}`,
            ),
            // Top membres SUR LA FENÊTRE : l'audit porte l'auteur de chaque
            // message humain. memberActivity est un cumul depuis toujours
            // (il faisait annoncer 9 messages là où la fenêtre en compte 7).
            this.prisma.$queryRaw<Array<{ userId: string; messages: bigint }>>(
              Prisma.sql`SELECT "actorId" AS userId, COUNT(*) AS messages
                         FROM "audit_logs"
                         WHERE "guildId" = ${ctx.guildId} AND "action" = ${'message.created'} AND "createdAt" >= ${since} AND "actorId" IS NOT NULL
                         GROUP BY "actorId" ORDER BY messages DESC, "actorId" ASC LIMIT 5`,
            ),
          ]);
          // Pas de suivi du vocal par fenêtre : minutes CUMULÉES, annoncées comme telles.
          const voiceRows =
            topMembers.length > 0
              ? await this.prisma.memberActivity.findMany({
                  where: { guildId: ctx.guildId, userId: { in: topMembers.map((row) => row.userId) } },
                  select: { userId: true, voiceMinutes: true },
                })
              : [];
          const voiceMinutesByUser = new Map(voiceRows.map((row) => [row.userId, row.voiceMinutes]));

          const dayRows = perDay.filter((row): row is { day: string; messages: bigint } => row.day !== null);
          const totalMessages = dayRows.reduce((sum, row) => sum + Number(row.messages), 0);
          const coverageSinceMs = coverage[0]?.since == null ? null : Number(coverage[0].since);
          const coverageFacts = describeCoverage({ sinceMs: coverageSinceMs, days });
          const effectiveDays = coverageFacts.effectiveDays;
          const perDayLines = dayRows.map((row) => `${row.day}: ${Number(row.messages)} msg`);
          const topLines = topMembers.map(
            (row, index) =>
              `${index + 1}. <@${row.userId}> (${Number(row.messages)} msg sur la fenêtre, ${voiceMinutesByUser.get(row.userId) ?? 0} min de vocal en cumul)`,
          );
          const summary = [
            `${totalMessages} message(s) humain(s) sur la fenêtre, réparti(s) sur ${dayRows.length} jour(s) différent(s) (moyenne ${dayRows.length > 0 ? Math.round(totalMessages / effectiveDays) : 0}/jour).`,
            `Arrivées: ${Number(joins[0]?.joined ?? 0)}, départs: ${Number(joins[0]?.left ?? 0)}.`,
            perDayLines.length > 0 ? `Par jour : ${perDayLines.join(' | ')}` : '',
            topLines.length > 0 ? `Top membres : ${topLines.join(' | ')}` : 'Aucun message de membre sur la fenêtre.',
            coverageFacts.line
          ]
            .filter(Boolean)
            .join('\n');
          return {
            ok: true,
            summary,
            data: {
              days,
              totalMessages,
              coverageSince: coverageSinceMs !== null ? new Date(coverageSinceMs).toISOString() : null,
              effectiveDays,
              joined: Number(joins[0]?.joined ?? 0),
              left: Number(joins[0]?.left ?? 0),
              perDay: dayRows.map((row) => ({ day: row.day, messages: Number(row.messages) })),
              topMembers: topMembers.map((row) => ({
                userId: row.userId,
                messages: Number(row.messages),
                voiceMinutesCumul: voiceMinutesByUser.get(row.userId) ?? 0,
              })),
            },
          };
        },
      },
    ];
  }
}
