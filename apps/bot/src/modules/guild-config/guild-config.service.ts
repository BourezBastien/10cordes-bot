import { Injectable } from '@spraxium/common';
import { GuildConfigSchema, type GuildConfig } from '@10cordes/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { deepMerge } from '../../shared/utils/object';

// Les exception layouts sont instanciés par le framework sans DI — le service
// s'enregistre ici pour rendre la config accessible au GuildErrorLayout.
let layoutInstance: GuildConfigService | undefined;

export function getConfigServiceForLayout(): GuildConfigService {
  if (!layoutInstance) throw new Error('GuildConfigService is not initialized yet.');
  return layoutInstance;
}

/**
 * Configuration par serveur — un seul document JSON typé (Zod), cache mémoire
 * invalidé à l'écriture, auto-provision à la première lecture.
 */
@Injectable()
export class GuildConfigService {
  private readonly cache = new Map<string, GuildConfig>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    layoutInstance = this;
  }

  async get(guildId: string): Promise<GuildConfig> {
    const cached = this.cache.get(guildId);
    if (cached) return cached;

    const row = await this.prisma.guild.upsert({
      where: { id: guildId },
      update: {},
      create: { id: guildId },
    });
    const config = GuildConfigSchema.parse(JSON.parse(row.settings) ?? {});
    this.cache.set(guildId, config);
    return config;
  }

  /** Fusionne un patch partiel puis re-valide TOUT le document avant écriture. */
  async patch(guildId: string, patch: Record<string, unknown>): Promise<GuildConfig> {
    const current = await this.get(guildId);
    const merged = GuildConfigSchema.parse(deepMerge(current as unknown as Record<string, unknown>, patch));
    await this.prisma.guild.update({
      where: { id: guildId },
      data: { settings: JSON.stringify(merged) },
    });
    this.cache.set(guildId, merged);
    this.audit.record({
      guildId,
      source: 'discord',
      action: 'config.patch',
      metadata: { keys: Object.keys(patch) },
    });
    return merged;
  }

  /** Export brut du document de configuration (transfert vers un autre serveur). */
  async exportConfig(guildId: string): Promise<string> {
    const config = await this.get(guildId);
    return JSON.stringify(config, null, 2);
  }

  /** Remplace intégralement la configuration (validée) — import depuis un export. */
  async importConfig(guildId: string, json: string): Promise<GuildConfig> {
    const parsed = GuildConfigSchema.parse(JSON.parse(json));
    await this.prisma.guild.upsert({
      where: { id: guildId },
      update: { settings: JSON.stringify(parsed) },
      create: { id: guildId, settings: JSON.stringify(parsed) },
    });
    this.cache.set(guildId, parsed);
    this.audit.record({
      guildId,
      source: 'discord',
      action: 'config.import',
      metadata: { keys: Object.keys(parsed) },
    });
    return parsed;
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }
}
