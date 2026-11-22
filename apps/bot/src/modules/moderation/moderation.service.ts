import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { PermissionFlagsBits, Client, type Guild, type GuildMember, type User } from 'discord.js';
import { PermissionDeniedException, ValidationException } from '@spraxium/core';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';

export type ModAction =
  | 'warn'
  | 'timeout'
  | 'untimeout'
  | 'kick'
  | 'ban'
  | 'unban'
  | 'derank'
  | 'purge';

export interface CaseEntry {
  caseId: number;
  userId: string;
  moderatorId: string;
  action: ModAction | string;
  reason?: string | null;
  durationMs?: number | null;
  createdAt: Date;
}

export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1_000;

/** Levée quand la commande est utilisée hors du salon de sanctions dédié (12✅). */
export class SanctionChannelException extends Error {
  readonly channelId: string;
  constructor(channelId: string) {
    super(`Sanctions are restricted to <#${channelId}>.`);
    this.channelId = channelId;
  }
}

@Injectable()
export class ModerationService implements SpraxiumOnBoot {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: GuildConfigService,
    private readonly client: Client,
  ) {}

  /** Enregistre getCases : l'agent répond à « qui a été ban ce mois-ci, par qui, pourquoi ». */
  onBoot(): void {
    const registry = getToolRegistry();
    const tool: BotTool = {
      name: 'getCases',
      description:
        'Lit les cases de modération du serveur : filtres par action (warn/timeout/kick/ban/unban/derank/purge) et nombre de jours. Renvoie case #, membre, modérateur, raison, date.',
      category: 'moderation',
      paramsSchema: z.object({
        action: z.enum(['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'derank', 'purge']).optional(),
        days: z.number().int().min(1).max(365).default(30),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'Read-only. Répond à « qui a été ban ce mois-ci », « liste les warns », etc. Cite la case #, le membre, le modérateur et la date de chaque entrée.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { action, days, limit } = input as { action?: string; days?: number; limit?: number };
        const since = new Date(Date.now() - (days ?? 30) * 24 * 60 * 60 * 1000);
        const cases = await this.prisma.modCase.findMany({
          where: {
            guildId: ctx.guildId,
            ...(action ? { action } : {}),
            createdAt: { gte: since },
          },
          orderBy: { createdAt: 'desc' },
          take: limit ?? 10,
        });
        if (cases.length === 0) return { ok: true, summary: `Aucune case de modération sur les ${days ?? 30} derniers jours.` };
        const lines = cases.map(
          (entry) =>
            `case #${entry.caseId} [${entry.action}] <@${entry.userId}> par <@${entry.moderatorId}> le ${entry.createdAt.toLocaleString('fr-FR')}${entry.reason ? ` : ${entry.reason}` : ''}`,
        );
        return { ok: true, summary: `${cases.length} case(s) : ${lines.join(' | ')}`, data: { count: cases.length } };
      },
    };
    registry.register(tool);
  }

  /** Les sanctions sont restreintes au salon dédié si configuré. */
  async assertSanctionChannel(guildId: string, channelId: string): Promise<void> {
    const config = await this.config.get(guildId);
    const restricted = config.moderation.sanctionChannelId;
    if (restricted && channelId !== restricted) throw new SanctionChannelException(restricted);
  }

  /** Hiérarchie : cible non-owner, modo au-dessus de la cible (sauf admin/owner), bot au-dessus de la cible. */
  assertHierarchy(moderator: GuildMember, target: GuildMember, me: GuildMember): void {
    if (target.id === target.guild.ownerId) {
      throw new PermissionDeniedException({ permission: 'server owner' });
    }
    const isModeratorOwner = moderator.id === moderator.guild.ownerId;
    const isModeratorAdmin = moderator.permissions.has(PermissionFlagsBits.Administrator);
    if (!isModeratorOwner && !isModeratorAdmin && moderator.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
      throw new PermissionDeniedException({ permission: 'higher role than the target' });
    }
    if (me.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
      throw new PermissionDeniedException({ permission: 'bot role above the target' });
    }
  }

  private async nextCaseId(guildId: string): Promise<number> {
    const counter = await this.prisma.modCounter.upsert({
      where: { guildId },
      update: { value: { increment: 1 } },
      create: { guildId, value: 1 },
    });
    return counter.value;
  }

  private async createCase(
    guildId: string,
    entry: {
      userId: string;
      moderatorId: string;
      action: ModAction;
      reason?: string | null;
      durationMs?: number | null;
    },
  ): Promise<CaseEntry> {
    const caseId = await this.nextCaseId(guildId);
    const row = await this.prisma.modCase.create({
      data: {
        guildId,
        caseId,
        userId: entry.userId,
        moderatorId: entry.moderatorId,
        action: entry.action,
        reason: entry.reason ?? null,
        durationMs: entry.durationMs ?? null,
      },
    });
    this.audit.record({
      guildId,
      source: 'discord',
      action: `mod.${entry.action}`,
      actorId: entry.moderatorId,
      targetId: entry.userId,
      metadata: { caseId, reason: entry.reason ?? null, durationMs: entry.durationMs ?? null },
    });
    return row as CaseEntry;
  }

  async warn(guild: Guild, target: GuildMember, moderatorId: string, reason: string): Promise<CaseEntry> {
    const entry = await this.createCase(guild.id, {
      userId: target.id,
      moderatorId,
      action: 'warn',
      reason,
    });
    await target.send(`⚠️ You were warned in **${guild.name}** (case #${entry.caseId}) : ${reason}`).catch(() => {});
    return entry;
  }

  async userWarnings(guildId: string, userId: string): Promise<CaseEntry[]> {
    return this.prisma.modCase.findMany({
      where: { guildId, userId, action: 'warn' },
      orderBy: { caseId: 'desc' },
    }) as unknown as Promise<CaseEntry[]>;
  }

  async timeout(
    guild: Guild,
    target: GuildMember,
    moderatorId: string,
    durationMs: number,
    reason: string | null,
  ): Promise<CaseEntry> {
    if (durationMs < 1_000 || durationMs > MAX_TIMEOUT_MS) {
      throw new ValidationException({
        field: 'duration',
        reason: `Duration must be between 1s and 28 days (got ${durationMs}ms).`,
      });
    }
    const entry = await this.createCase(guild.id, {
      userId: target.id,
      moderatorId,
      action: 'timeout',
      reason,
      durationMs,
    });
    await target.timeout(durationMs, reason ?? undefined);
    return entry;
  }

  async untimeout(guild: Guild, target: GuildMember, moderatorId: string, reason: string | null): Promise<CaseEntry> {
    const entry = await this.createCase(guild.id, {
      userId: target.id,
      moderatorId,
      action: 'untimeout',
      reason,
    });
    await target.timeout(null, reason ?? undefined);
    return entry;
  }

  async kick(guild: Guild, target: GuildMember, moderatorId: string, reason: string | null): Promise<CaseEntry> {
    if (!target.kickable) {
      throw new PermissionDeniedException({ permission: 'kick this member (bot hierarchy)' });
    }
    const entry = await this.createCase(guild.id, {
      userId: target.id,
      moderatorId,
      action: 'kick',
      reason,
    });
    await target
      .send(`👢 You were kicked from **${guild.name}** (case #${entry.caseId})${reason ? ` : ${reason}` : ''}`)
      .catch(() => {});
    await target.kick(reason ?? undefined);
    return entry;
  }

  async ban(
    guild: Guild,
    targetUser: User,
    moderatorId: string,
    reason: string | null,
    purgeMessages: boolean,
  ): Promise<CaseEntry> {
    const entry = await this.createCase(guild.id, {
      userId: targetUser.id,
      moderatorId,
      action: 'ban',
      reason,
    });
    await targetUser
      .send(`⛔ You were banned from **${guild.name}** (case #${entry.caseId})${reason ? ` : ${reason}` : ''}`)
      .catch(() => {});
    await guild.members.ban(targetUser.id, {
      reason: `case #${entry.caseId}${reason ? ` : ${reason}` : ''}`,
      deleteMessageSeconds: purgeMessages ? 24 * 60 * 60 : 0,
    });
    return entry;
  }

  async unban(guild: Guild, targetUserId: string, moderatorId: string, reason: string | null): Promise<void> {
    await this.createCase(guild.id, {
      userId: targetUserId,
      moderatorId,
      action: 'unban',
      reason,
    });
    await guild.members.unban(targetUserId, reason ?? undefined);
  }

  async caseById(guildId: string, caseId: number): Promise<CaseEntry | null> {
    const row = await this.prisma.modCase.findUnique({
      where: { guildId_caseId: { guildId, caseId } },
    });
    return row as CaseEntry | null;
  }

  async cases(guildId: string, userId?: string): Promise<CaseEntry[]> {
    return this.prisma.modCase.findMany({
      where: { guildId, ...(userId ? { userId } : {}) },
      orderBy: { caseId: 'desc' },
      take: 25,
    }) as unknown as Promise<CaseEntry[]>;
  }

  async timeoutInfo(target: GuildMember): Promise<{ until: Date } | null> {
    const communication = target.communicationDisabledUntilTimestamp;
    if (!communication || communication <= Date.now()) return null;
    return { until: new Date(communication) };
  }

  /** Purge jusqu'à `count` messages récents (≤ 14 jours — limite Discord), filtrés par user si fourni. */
  async purge(channelId: string, guildId: string, moderatorId: string, count: number, userId?: string): Promise<number> {
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || channel.partial) return 0;
    const textChannel = channel as import('discord.js').TextChannel;

    const fetched = await textChannel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!fetched) return 0;

    const now = Date.now();
    const deletable = fetched.filter(
      (message) =>
        now - message.createdTimestamp < 14 * 24 * 60 * 60 * 1_000 && (!userId || message.author.id === userId),
    );
    const targets = deletable.first(Math.min(count, 100)) ?? [];
    if (targets.length === 0) return 0;

    await textChannel.bulkDelete(targets, true).catch(() => 0);
    const deleted = targets.length;

    this.audit.record({
      guildId,
      source: 'discord',
      action: 'mod.purge',
      actorId: moderatorId,
      targetId: userId ?? null,
      metadata: { deleted, channelId },
    });
    return deleted;
  }

  /** Dérank : snapshot des rôles en backup, puis retrait de tous les rôles attribuables. */
  async derank(member: GuildMember, moderatorId: string, reason: string | null): Promise<number> {
    const roleIds = [...member.roles.cache.keys()].filter((roleId) => roleId !== member.guild.id);
    await this.prisma.roleBackup.create({
      data: {
        guildId: member.guild.id,
        userId: member.id,
        roleIds: JSON.stringify(roleIds),
        createdBy: moderatorId,
      },
    });
    const removable = roleIds
      .map((roleId) => member.roles.cache.get(roleId))
      .filter((role): role is NonNullable<typeof role> => role !== undefined && !role.managed);
    await member.roles.remove(removable, reason ?? 'derank');
    this.audit.record({
      guildId: member.guild.id,
      source: 'discord',
      action: 'mod.derank',
      actorId: moderatorId,
      targetId: member.id,
      metadata: { roles: roleIds.length, reason },
    });
    return roleIds.length;
  }

  /** Restaure les rôles du dernier backup du membre. */
  async restoreRoles(member: GuildMember, moderatorId: string): Promise<number> {
    const backup = await this.prisma.roleBackup.findFirst({
      where: { guildId: member.guild.id, userId: member.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!backup) return 0;

    const roleIds = (JSON.parse(backup.roleIds) as string[]).filter((roleId) =>
      member.guild.roles.cache.has(roleId),
    );
    await member.roles.add(roleIds, 'role restore').catch(() => {});
    this.audit.record({
      guildId: member.guild.id,
      source: 'discord',
      action: 'mod.restoreRoles',
      actorId: moderatorId,
      targetId: member.id,
      metadata: { restored: roleIds.length },
    });
    return roleIds.length;
  }
}
