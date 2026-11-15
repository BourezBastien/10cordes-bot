import { Injectable } from '@spraxium/common';
import { PrismaService } from '../database/prisma.service';

export interface AuditEntry {
  guildId?: string | null;
  source?: 'discord' | 'api' | 'agent' | 'system';
  action: string;
  actorId?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditQuery {
  source?: string;
  limit?: number;
}

/**
 * Journal d'audit global (0.11) — fire-and-forget : une erreur d'audit
 * n'échoue jamais sur l'action audité.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(entry: AuditEntry): void {
    void this.prisma.auditLog
      .create({
        data: {
          guildId: entry.guildId ?? null,
          source: entry.source ?? 'system',
          action: entry.action,
          actorId: entry.actorId ?? null,
          targetId: entry.targetId ?? null,
          metadata: JSON.stringify(entry.metadata ?? {}),
        },
      })
      .catch(() => {});
  }

  async recent(guildId: string | null, query: AuditQuery = {}): Promise<
    Array<{ id: string; guildId: string | null; source: string; action: string; actorId: string | null; targetId: string | null; createdAt: Date }>
  > {
    return this.prisma.auditLog.findMany({
      where: {
        ...(guildId ? { guildId } : {}),
        ...(query.source ? { source: query.source } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(query.limit ?? 10, 25),
    });
  }

  async stats(guildId: string): Promise<Array<{ action: string; count: number }>> {
    const grouped = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: { guildId },
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
      take: 10,
    });
    return grouped.map((row) => ({ action: row.action, count: row._count.action }));
  }
}
