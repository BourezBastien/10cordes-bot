import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client, type Message } from 'discord.js';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';

/**
 * XP et niveaux passifs (config levels.*, désactivé par défaut) : XP par
 * message avec cooldown 60s/utilisateur, paliers 5n²+50n+100, annonce de
 * level-up et rôles-récompenses automatiques. Tools rank/leaderboard.
 */

/** XP nécessaire pour passer du niveau n au niveau n+1. */
function xpForNextLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

const XP_COOLDOWN_MS = 60_000;

@Injectable()
export class LevelsService implements SpraxiumOnBoot {
  private readonly log = new Logger('Levels');
  private readonly cooldowns = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: Client,
    private readonly config: GuildConfigService,
  ) {}

  onBoot(): void {
    for (const tool of this.buildTools()) getToolRegistry().register(tool);
    this.log.info(`${this.buildTools().length} tools levels enregistrés.`);
  }

  /** XP passif sur un message (humain, cooldown, config enabled). */
  async grantForMessage(message: Message): Promise<void> {
    if (!message.guildId || !message.member || message.author.bot) return;
    const config = await this.config.get(message.guildId).catch(() => null);
    if (!config?.levels.enabled) return;
    const key = `${message.guildId}:${message.author.id}`;
    const last = this.cooldowns.get(key) ?? 0;
    if (Date.now() - last < XP_COOLDOWN_MS) return;
    this.cooldowns.set(key, Date.now());

    const gained = config.levels.xpPerMessage;
    const row = await this.prisma.userLevel.upsert({
      where: { guildId_userId: { guildId: message.guildId, userId: message.author.id } },
      create: { guildId: message.guildId, userId: message.author.id, xp: gained },
      update: { xp: { increment: gained } },
    });

    let xp = row.xp;
    let level = row.level;
    let leveledUp = false;
    while (xp >= xpForNextLevel(level)) {
      xp -= xpForNextLevel(level);
      level += 1;
      leveledUp = true;
    }
    if (!leveledUp) {
      await this.prisma.userLevel.update({
        where: { guildId_userId: { guildId: message.guildId, userId: message.author.id } },
        data: { xp },
      });
      return;
    }
    await this.prisma.userLevel.update({
      where: { guildId_userId: { guildId: message.guildId, userId: message.author.id } },
      data: { xp, level },
    });

    // Rôles-récompenses atteints (LevelReward { level, roleId }).
    const rewards = (config.levels.roleRewards ?? []).filter((reward) => reward.level <= level);
    const guild = message.guild;
    if (guild) {
      for (const reward of rewards) {
        const role = message.member.roles.cache.has(reward.roleId) ? null : guild.roles.cache.get(reward.roleId);
        if (role && message.member.manageable) {
          await message.member.roles.add(role, `niveau ${level} atteint`).catch(() => {});
        }
      }
    }

    const announceChannelId = config.levels.announceChannelId ?? message.channelId;
    const channel = guild?.channels.cache.get(announceChannelId ?? message.channelId);
    if (channel?.isTextBased()) {
      await channel.send({ content: `🎊 <@${message.author.id}> passe au niveau **${level}** !` }).catch(() => {});
    }
  }

  private buildTools(): BotTool[] {
    return [
      {
        name: 'member.level',
        description: 'Niveau et XP d\u0029un membre (ou soi-même) : progression vers le niveau suivant.',
        category: 'levels',
        paramsSchema: z.object({ userId: z.string().min(1).optional().describe('Par défaut soi-même') }),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Read-only. L\u0029XP est active si config levels.enabled (le dire si désactivé).',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { userId } = input as { userId?: string };
          const target = userId ?? ctx.userId;
          const config = await this.config.get(ctx.guildId).catch(() => null);
          if (!config?.levels.enabled) {
            return { ok: true, summary: 'XP désactivée sur ce serveur (config levels.enabled).' };
          }
          const row = await this.prisma.userLevel.findUnique({
            where: { guildId_userId: { guildId: ctx.guildId, userId: target } },
          });
          if (!row) return { ok: true, summary: `<@${target}> : pas encore d\u0029XP (niveau 0).` };
          const needed = xpForNextLevel(row.level);
          return {
            ok: true,
            summary: `<@${target}> : niveau **${row.level}**, ${row.xp}/${needed} XP vers le niveau suivant.`,
            data: { level: row.level, xp: row.xp, needed },
          };
        },
      },
      {
        name: 'server.levels',
        description: 'Classement des niveaux du serveur (top XP).',
        category: 'levels',
        paramsSchema: z.object({ limit: z.number().int().min(3).max(15).default(10) }),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Read-only. En [PANEL] si demandé publiquement.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { limit } = input as { limit?: number };
          const rows = await this.prisma.userLevel.findMany({
            where: { guildId: ctx.guildId },
            orderBy: [{ level: 'desc' }, { xp: 'desc' }],
            take: limit ?? 10,
          });
          if (rows.length === 0) return { ok: true, summary: 'Aucun niveau enregistré (XP désactivée ou serveur calme).' };
          const lines = rows.map((row, index) => `${index + 1}. <@${row.userId}> — niveau ${row.level} (${row.xp} XP)`);
          return { ok: true, summary: `Classement des niveaux : ${lines.join(' | ')}` };
        },
      },
      {
        name: 'levels.addXp',
        description: 'Ajoute (ou retire) de l\u0029XP à un membre, déclenche les paliers.',
        category: 'levels',
        paramsSchema: z.object({
          userId: z.string().min(1),
          amount: z.number().int().min(-10_000).max(10_000),
        }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Correction staff. Les rôles-récompenses s\u0029appliquent automatiquement si configurés.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { userId, amount } = input as { userId: string; amount: number };
          const row = await this.prisma.userLevel.upsert({
            where: { guildId_userId: { guildId: ctx.guildId, userId } },
            create: { guildId: ctx.guildId, userId, xp: Math.max(0, amount) },
            update: { xp: { increment: amount } },
          });
          return { ok: true, summary: `<@${userId}> : niveau ${row.level}, ${row.xp} XP après correction.` };
        },
      },
    ];
  }
}
