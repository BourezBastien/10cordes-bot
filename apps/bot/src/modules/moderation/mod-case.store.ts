import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../database/prisma.service';
import type { CaseEntry, ModAction } from './moderation.types';

/**
 * Dossier de modération d'un serveur (tables ModCase et ModCounter) : crée
 * les cases (numéro par serveur, piste d'audit) et les lit.
 */
export class ModCaseStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async nextCaseId(guildId: string): Promise<number> {
    const counter = await this.prisma.modCounter.upsert({
      where: { guildId },
      update: { value: { increment: 1 } },
      create: { guildId, value: 1 },
    });
    return counter.value;
  }

  async createCase(
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

  async userWarnings(guildId: string, userId: string): Promise<CaseEntry[]> {
    return this.prisma.modCase.findMany({
      where: { guildId, userId, action: 'warn' },
      orderBy: { caseId: 'desc' },
    }) as unknown as Promise<CaseEntry[]>;
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
}
