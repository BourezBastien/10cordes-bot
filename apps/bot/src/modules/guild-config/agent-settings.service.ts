import { Injectable } from '@spraxium/common';
import { PrismaService } from '../database/prisma.service';

export type ThinkingMode = 'adaptive' | 'always' | 'off';

export interface AgentSettings {
  thinkingMode: ThinkingMode;
  configThreadId: string | null;
}

const CACHE_TTL_MS = 60_000;

/**
 * Réglages agent PAR SERVEUR (thinking adaptatif, fil de config privé).
 * Source de vérité = table guild_agent_settings ; défauts sans ligne.
 * Consommé par LlmService (thinking) et ConfigThreadService (fil privé).
 */
@Injectable()
export class AgentSettingsService {
  private readonly cache = new Map<string, { settings: AgentSettings; fetchedAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

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

  async patch(guildId: string, patch: Partial<AgentSettings>): Promise<AgentSettings> {
    const current = await this.get(guildId);
    const merged: AgentSettings = { ...current, ...patch };
    await this.prisma.guildAgentSettings.upsert({
      where: { guildId },
      create: { guildId, thinkingMode: merged.thinkingMode, configThreadId: merged.configThreadId },
      update: { thinkingMode: merged.thinkingMode, configThreadId: merged.configThreadId },
    });
    this.cache.delete(guildId);
    return merged;
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }
}
