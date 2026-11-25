import { Injectable } from '@spraxium/common';
import type { AuditEntry } from '../audit/audit.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';

export type ThinkingMode = 'adaptive' | 'always' | 'off';

export interface AgentSettings {
  thinkingMode: ThinkingMode;
  configThreadId: string | null;
}

/** Origine d'une écriture, pour l'audit : l'API du dashboard, ou l'agent (outils Discord). */
type AuditSource = NonNullable<AuditEntry['source']>;

const CACHE_TTL_MS = 60_000;

/**
 * Réglages agent PAR SERVEUR (thinking adaptatif, fil de config privé).
 * Source de vérité = table guild_agent_settings ; défauts sans ligne.
 * Consommé par LlmService (thinking) et ConfigThreadService (fil privé).
 */
@Injectable()
export class AgentSettingsService {
  private readonly cache = new Map<string, { settings: AgentSettings; fetchedAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(guildId: string): Promise<AgentSettings> {
    const cached = this.cache.get(guildId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.settings;
    const row = await this.prisma.guildAgentSettings.findUnique({ where: { guildId } }).catch(() => null);
    const settings: AgentSettings = {
      thinkingMode: row?.thinkingMode === 'always' || row?.thinkingMode === 'off' ? row.thinkingMode : 'adaptive',
      configThreadId: row?.configThreadId ?? null,
    };
    this.cache.set(guildId, { settings, fetchedAt: Date.now() });
    return settings;
  }

  /**
   * Écrit un patch partiel. Un `actorId` est donné quand quelqu'un a demandé le
   * changement (le dashboard) : l'écriture est alors journalisée. Sans lui
   * (fil de config, outil `config.thinking`), rien n'est journalisé, comme avant.
   */
  async patch(guildId: string, patch: Partial<AgentSettings>, actorId?: string, source: AuditSource = 'agent'): Promise<AgentSettings> {
    const current = await this.get(guildId);
    const merged: AgentSettings = { ...current, ...patch };
    await this.prisma.guildAgentSettings.upsert({
      where: { guildId },
      create: { guildId, thinkingMode: merged.thinkingMode, configThreadId: merged.configThreadId },
      update: { thinkingMode: merged.thinkingMode, configThreadId: merged.configThreadId },
    });
    this.cache.delete(guildId);
    if (actorId !== undefined) {
      this.audit.record({ guildId, source, action: 'settings.updated', actorId, metadata: { keys: Object.keys(patch), thinkingMode: merged.thinkingMode } });
    }
    return merged;
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }
}
