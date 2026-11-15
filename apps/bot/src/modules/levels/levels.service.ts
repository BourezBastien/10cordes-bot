import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { makeStatusTool } from '../../shared/tools/status-tool';

export const XP_PER_LEVEL_BASE = 100;

/** XP total nécessaire pour atteindre `level`. */
export function xpForLevel(level: number): number {
  return level * level * XP_PER_LEVEL_BASE;
}

export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / XP_PER_LEVEL_BASE));
}

export interface GrantResult {
  xp: number;
  level: number;
  leveledUp: boolean;
}

@Injectable()
export class LevelsService implements SpraxiumOnBoot {
  /** Cooldown XP par utilisateur (en mémoire — reset au restart, non bloquant). */
  private readonly cooldowns = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GuildConfigService,
    private readonly registry: ToolRegistryService,
  ) {}

  async onBoot(): Promise<void> {
    this.registry.register(
      makeStatusTool({
        name: 'levels.status',
        category: 'levels',
        description: 'Levels system setup on this server: enabled state, XP rate, rewards.',
        summary: async (guildId) => {
          const c = await this.config.get(guildId);
          return [
            `**Système** : ${c.levels.enabled ? 'activé' : 'désactivé'}`,
            `**XP/message** : ${c.levels.xpPerMessage}`,
            `**Cooldown** : ${c.levels.cooldownMinutes} min`,
            `**Annonces** : ${c.levels.announceChannelId ? `<#${c.levels.announceChannelId}>` : 'canal courant'}`,
            `**Récompenses** : ${c.levels.roleRewards.length} rôle(s)`,
          ].join(' · ');
        },
      }),
    );
  }

  isOnCooldown(guildId: string, userId: string, cooldownMs: number): boolean {
    if (cooldownMs <= 0) return false;
    const last = this.cooldowns.get(`${guildId}:${userId}`);
    return last !== undefined && Date.now() - last < cooldownMs;
  }

  markActivity(guildId: string, userId: string): void {
    this.cooldowns.set(`${guildId}:${userId}`, Date.now());
  }

  async grantXp(guildId: string, userId: string, amount: number): Promise<GrantResult> {
    const current = await this.prisma.userLevel.upsert({
      where: { guildId_userId: { guildId, userId } },
      update: {},
      create: { guildId, userId },
    });
    const xp = current.xp + amount;
    const level = levelForXp(xp);
    const updated = await this.prisma.userLevel.update({
      where: { id: current.id },
      data: { xp, level },
    });
    return { xp: updated.xp, level: updated.level, leveledUp: level > current.level };
  }

  async get(guildId: string, userId: string): Promise<{ xp: number; level: number } | null> {
    const row = await this.prisma.userLevel.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    return row ? { xp: row.xp, level: row.level } : null;
  }

  async leaderboard(guildId: string, limit = 10): Promise<Array<{ userId: string; xp: number; level: number }>> {
    const rows = await this.prisma.userLevel.findMany({
      where: { guildId },
      orderBy: { xp: 'desc' },
      take: Math.min(limit, 25),
    });
    return rows.map((row) => ({ userId: row.userId, xp: row.xp, level: row.level }));
  }
}
