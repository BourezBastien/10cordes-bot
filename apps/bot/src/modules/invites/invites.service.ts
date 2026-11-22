import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client, Events, type GuildMember, type Invite } from 'discord.js';
import { z } from 'zod';
import type { BotTool, ToolResult } from '@10cordes/shared';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Tracking des invitations (diff de cache au memberAdd, pattern CorwinDev) :
 * chaque join créditée l'inviteur réel. Tools : invités d'un membre,
 * leaderboard, correction manuelle (staff).
 */

interface CachedInvite {
  uses: number;
  inviterId: string | null;
}

@Injectable()
export class InvitesService implements SpraxiumOnBoot {
  private readonly log = new Logger('Invites');
  private readonly cache = new Map<string, Map<string, CachedInvite>>();

  constructor(
    private readonly client: Client,
    private readonly prisma: PrismaService,
  ) {}

  async onBoot(): Promise<void> {
    for (const tool of this.buildTools()) getToolRegistry().register(tool);
    this.log.info(`${this.buildTools().length} tools invites enregistrés.`);
    // Pré-charge les invites des serveurs connus.
    for (const guild of this.client.guilds.cache.values()) {
      await this.refresh(guild.id).catch(() => {});
    }
    this.client.on(Events.InviteCreate, (invite: Invite) => {
      const map = this.cache.get(invite.guild?.id ?? '') ?? new Map<string, CachedInvite>();
      if (invite.guild?.id) map.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
      if (invite.guild?.id) this.cache.set(invite.guild.id, map);
    });
    this.client.on(Events.InviteDelete, (invite: Invite) => {
      this.cache.get(invite.guild?.id ?? '')?.delete(invite.code);
    });
  }

  /** Re-fetch les invites d'un serveur et met à jour le cache. */
  async refresh(guildId: string): Promise<void> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return;
    const map = new Map<string, CachedInvite>();
    for (const invite of invites.values()) {
      map.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
    }
    this.cache.set(guildId, map);
  }

  /**
   * Au memberAdd : diff cache vs réel → l'invite dont les uses ont augmenté
   * crédite l'inviteur. Best-effort (vanity URLs et invites illimitées
   * introuvables = pas de crédit).
   */
  async creditJoin(member: GuildMember): Promise<string | null> {
    const guildId = member.guild.id;
    const before = this.cache.get(guildId);
    const now = await member.guild.invites.fetch().catch(() => null);
    if (!now) return null;
    let inviterId: string | null = null;
    for (const invite of now.values()) {
      const cached = before?.get(invite.code);
      if (cached && (invite.uses ?? 0) > cached.uses && invite.inviter?.id) {
        inviterId = invite.inviter.id;
        break;
      }
    }
    await this.refresh(guildId);
    if (!inviterId) return null;
    await this.prisma.inviteStat.upsert({
      where: { guildId_userId: { guildId, userId: inviterId } },
      create: { guildId, userId: inviterId, count: 1 },
      update: { count: { increment: 1 } },
    });
    return inviterId;
  }

  private buildTools(): BotTool[] {
    return [
      {
        name: 'invites.show',
        description: "Nombre d'invitations d'un membre (ou soi-même) sur ce serveur.",
        category: 'invites',
        paramsSchema: z.object({ userId: z.string().min(1).optional().describe('Par défaut soi-même') }),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Read-only. Le compteur compte les joins crédités depuis l\u0029activation.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { userId } = input as { userId?: string };
          const target = userId ?? ctx.userId;
          const row = await this.prisma.inviteStat.findUnique({
            where: { guildId_userId: { guildId: ctx.guildId, userId: target } },
          });
          return { ok: true, summary: `<@${target}> : ${row?.count ?? 0} invitation(s).` };
        },
      },
      {
        name: 'invites.leaderboard',
        description: 'Top inviteurs du serveur.',
        category: 'invites',
        paramsSchema: z.object({ limit: z.number().int().min(3).max(15).default(10) }),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Read-only. En [PANEL] si demandé publiquement.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { limit } = input as { limit?: number };
          const rows = await this.prisma.inviteStat.findMany({
            where: { guildId: ctx.guildId },
            orderBy: { count: 'desc' },
            take: limit ?? 10,
          });
          if (rows.length === 0) return { ok: true, summary: 'Aucune invitation enregistrée.' };
          const lines = rows.map((row, index) => `${index + 1}. <@${row.userId}> — ${row.count} invitation(s)`);
          return { ok: true, summary: `Top inviteurs : ${lines.join(' | ')}` };
        },
      },
      {
        name: 'invites.add',
        description: 'Corrige manuellement le compteur d\u0029invitations d\u0029un membre (+ ou -).',
        category: 'invites',
        paramsSchema: z.object({
          userId: z.string().min(1),
          delta: z.number().int().min(-1000).max(1000),
        }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Correction staff (import historique, compensation de faux negatifs).',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { userId, delta } = input as { userId: string; delta: number };
          const row = await this.prisma.inviteStat.upsert({
            where: { guildId_userId: { guildId: ctx.guildId, userId } },
            create: { guildId: ctx.guildId, userId, count: Math.max(0, delta) },
            update: { count: { increment: delta } },
          });
          return { ok: true, summary: `<@${userId}> : ${row.count} invitation(s) après correction.` };
        },
      },
    ];
  }
}
