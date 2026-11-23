import { SurfaceDefinitionSchema, type SurfaceDefinition } from '@10cordes/shared';
import type { PrismaService } from '../database/prisma.service';

/** Une surface lue et validée, telle que les handlers et les pipelines la consomment. */
export interface SurfaceRow {
  kind: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  kindLabel: string;
  definition: SurfaceDefinition;
  state: Record<string, unknown>;
}

/** Ligne brute de la table InteractiveSurface (définition et état encore sérialisés). */
export interface SurfaceRecord {
  id: string;
  kind: string;
  guildId: string;
  channelId: string;
  definition: string;
  state: string;
  messageId: string | null;
}

const RECORD_COLUMNS = { id: true, kind: true, guildId: true, channelId: true, definition: true, state: true, messageId: true } as const;

/**
 * Persistance des surfaces interactives (table InteractiveSurface). Lecture
 * tolérante (définition ou état illisible = surface absente), écritures qui
 * n'interrompent jamais l'appelant.
 */
export class SurfaceStore {
  constructor(private readonly prisma: PrismaService) {}

  /** Ligne brute par identifiant exact. */
  async findRow(surfaceId: string): Promise<SurfaceRecord | null> {
    return this.prisma.interactiveSurface.findUnique({ where: { id: surfaceId }, select: RECORD_COLUMNS });
  }

  /** Surface validée : null si absente ou illisible (JSON ou schéma invalide). */
  async load(surfaceId: string): Promise<SurfaceRow | null> {
    const row = await this.findRow(surfaceId);
    if (!row) return null;
    try {
      return {
        kind: 'surface',
        guildId: row.guildId,
        channelId: row.channelId,
        messageId: row.messageId,
        kindLabel: row.kind,
        definition: SurfaceDefinitionSchema.parse(JSON.parse(row.definition)),
        state: JSON.parse(row.state || '{}') as Record<string, unknown>,
      };
    } catch {
      return null;
    }
  }

  async saveState(surfaceId: string, state: Record<string, unknown>): Promise<void> {
    await this.prisma.interactiveSurface.update({ where: { id: surfaceId }, data: { state: JSON.stringify(state) } }).catch(() => {});
  }

  async saveDefinition(surfaceId: string, definition: SurfaceDefinition): Promise<void> {
    await this.prisma.interactiveSurface.update({
      where: { id: surfaceId },
      data: { definition: JSON.stringify(definition) },
    }).catch(() => {});
  }

  /** Retient le message Discord qui affiche la surface (édition en place au re-rendu). */
  async attachMessage(surfaceId: string, messageId: string): Promise<void> {
    await this.prisma.interactiveSurface.update({ where: { id: surfaceId }, data: { messageId } }).catch(() => {});
  }

  /**
   * Résolution tolérante : par surfaceId exact, sinon par identifiant tronqué
   * (préfixe long et unique, un modèle omet parfois le dernier caractère),
   * sinon par messageId affiché (le plus récent).
   */
  async find(guildId: string, surfaceId: string | undefined, messageId: string | undefined): Promise<SurfaceRecord | null> {
    if (surfaceId) {
      const byId = await this.prisma.interactiveSurface.findFirst({ where: { id: surfaceId, guildId }, select: RECORD_COLUMNS });
      if (byId) return byId;
      if (surfaceId.length >= 20) {
        const candidates = await this.prisma.interactiveSurface.findMany({ where: { guildId, id: { startsWith: surfaceId } }, select: RECORD_COLUMNS, take: 2 });
        if (candidates.length === 1) return candidates[0];
      }
    }
    if (messageId) {
      const byMessage = await this.prisma.interactiveSurface.findFirst({
        where: { messageId, guildId },
        orderBy: { createdAt: 'desc' },
        select: RECORD_COLUMNS,
      });
      if (byMessage) return byMessage;
    }
    return null;
  }
}
