import { Injectable } from '@spraxium/common';
import { ModuleConstraintsSchema, type GuildModuleStateView, type ModuleConstraints } from '@10cordes/shared';
import { PrismaService } from '../database/prisma.service';

/** État des modules PAR SERVEUR (Prisma) — la couche au-dessus du toggle global. */
@Injectable()
export class GuildModuleStateService {
  private readonly cache = new Map<string, Map<string, GuildModuleStateView>>();

  constructor(private readonly prisma: PrismaService) {}

  private async load(guildId: string): Promise<Map<string, GuildModuleStateView>> {
    let entries = this.cache.get(guildId);
    if (!entries) {
      entries = new Map();
      const rows = await this.prisma.guildModuleState.findMany({ where: { guildId } });
      for (const row of rows) {
        entries.set(row.moduleId, {
          moduleId: row.moduleId,
          enabled: row.enabled,
          constraints: ModuleConstraintsSchema.parse(JSON.parse(row.constraints)),
        });
      }
      this.cache.set(guildId, entries);
    }
    return entries;
  }

  private async ensureGuild(guildId: string): Promise<void> {
    await this.prisma.guild.upsert({ where: { id: guildId }, update: {}, create: { id: guildId } });
  }

  async isEnabled(guildId: string, moduleId: string): Promise<boolean> {
    const entries = await this.load(guildId);
    return entries.get(moduleId)?.enabled ?? true;
  }

  async setEnabled(guildId: string, moduleId: string, enabled: boolean): Promise<void> {
    await this.ensureGuild(guildId);
    const constraints = await this.getConstraints(guildId, moduleId);
    await this.prisma.guildModuleState.upsert({
      where: { guildId_moduleId: { guildId, moduleId } },
      update: { enabled },
      create: { guildId, moduleId, enabled, constraints: JSON.stringify(constraints) },
    });
    const entries = await this.load(guildId);
    const existing = entries.get(moduleId);
    entries.set(moduleId, {
      moduleId,
      enabled,
      constraints: existing?.constraints ?? constraints,
    });
  }

  async getConstraints(guildId: string, moduleId: string): Promise<ModuleConstraints> {
    const entries = await this.load(guildId);
    return entries.get(moduleId)?.constraints ?? ModuleConstraintsSchema.parse({});
  }

  async updateConstraints(
    guildId: string,
    moduleId: string,
    patch: Partial<ModuleConstraints>,
  ): Promise<ModuleConstraints> {
    await this.ensureGuild(guildId);
    const current = await this.getConstraints(guildId, moduleId);
    const merged = ModuleConstraintsSchema.parse({ ...current, ...patch });
    const existing = (await this.load(guildId)).get(moduleId);
    await this.prisma.guildModuleState.upsert({
      where: { guildId_moduleId: { guildId, moduleId } },
      update: { constraints: JSON.stringify(merged) },
      create: {
        guildId,
        moduleId,
        enabled: existing?.enabled ?? true,
        constraints: JSON.stringify(merged),
      },
    });
    (await this.load(guildId)).set(moduleId, {
      moduleId,
      enabled: existing?.enabled ?? true,
      constraints: merged,
    });
    return merged;
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }
}
