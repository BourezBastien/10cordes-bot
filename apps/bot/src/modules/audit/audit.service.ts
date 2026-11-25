import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { PrismaService } from '../database/prisma.service';
import { stringifySafe } from '../../shared/utils/object';

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

/** Reçoit chaque entrée d'audit au moment où elle est journalisée (jamais son écriture en base). */
export type AuditListener = (entry: AuditEntry) => void;

/**
 * Journal d'audit global (0.11) : fire-and-forget, une erreur d'audit
 * n'échoue jamais l'action auditée, mais elle est LOGGÉE (jamais avalée).
 *
 * `onRecord` : un écouteur est prévenu de chaque entrée à l'instant où elle
 * arrive (le temps réel du panel en tire ses événements). L'entrée ne porte
 * jamais un secret : les émetteurs ne journalisent que des masques.
 */
@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');
  private readonly listeners: AuditListener[] = [];

  constructor(private readonly prisma: PrismaService) {}

  /** Abonne un écouteur ; rend la fonction qui le désabonne. */
  onRecord(listener: AuditListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  record(entry: AuditEntry): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(entry);
      } catch (error) {
        this.log.warn(`écouteur d\u0027audit « ${entry.action} » en échec : ${(error as Error).message.slice(0, 140)}`);
      }
    }
    void (async () => {
      try {
        // AuditLog.guildId porte une FK réelle vers guilds : seule
        // GuildConfigService.get() créait le row Guild. Tout audit émis
        // avant un premier accès config (guild fraîche, events de boot)
        // violait la FK et était perdu SANS trace (l'ancien .catch vide).
        if (entry.guildId) {
          await this.prisma.guild.upsert({
            where: { id: entry.guildId },
            create: { id: entry.guildId },
            update: {},
          });
        }
        await this.prisma.auditLog.create({
          data: {
            guildId: entry.guildId ?? null,
            source: entry.source ?? 'system',
            action: entry.action,
            actorId: entry.actorId ?? null,
            targetId: entry.targetId ?? null,
            metadata: stringifySafe(entry.metadata ?? {}),
          },
        });
      } catch (error) {
        this.log.warn(`audit « ${entry.action} » perdu : ${(error as Error).message.slice(0, 140)}`);
      }
    })();
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
