import { Injectable } from '@spraxium/common';
import { PrismaService } from '../database/prisma.service';

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
export class LevelsService {
  /** Cooldown XP par utilisateur (en mémoire — reset au restart, non bloquant). */
  private readonly cooldowns = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

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
