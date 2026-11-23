import { Global, Module } from '@spraxium/common';
import { Client } from 'discord.js';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ModuleManagerModule } from '../module-manager/module-manager.module';
import { PrismaService } from '../database/prisma.service';
import { CacheModule } from '../../shared/cache/cache.module';
import { CacheStoreService } from '../../shared/cache/cache-store.service';
import { ToolRegistryService, bindRegistryRuntimeDeps } from './tool-registry.service';

/**
 * @Global : le registry est le hub unique des tools. Les dépendances runtime
 * (prisma, client, cache, rendu de surface différé) sont liées ici ; les
 * RÈGLES sont liées par GuildRulesModule (chargé après) — cycles DI cassés
 * par accesseurs plutôt que par imports croisés.
 */
@Global()
@Module({
  imports: [AuditModule, CacheModule, DatabaseModule, GuildConfigModule, ModuleManagerModule],
  providers: [ToolRegistryService],
  exports: [ToolRegistryService],
})
export class ToolRegistryModule {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: Client,
    private readonly cache: CacheStoreService,
  ) {
    // Rendu de surface différé : SurfaceModule se charge APRÈS celui-ci
    // (il importe ToolRegistryModule), la résolution reste paresseuse.
    const renderSurface = async (surfaceId: string): Promise<void> => {
      const { getSurfaceRuntime } = await import('../surface/surface.module');
      const runtime = getSurfaceRuntime();
      if (!runtime) throw new Error('SurfaceModule non initialisé.');
      await runtime.render(surfaceId);
    };
    bindRegistryRuntimeDeps({ prisma: this.prisma, client: this.client, cache: this.cache, renderSurface });
  }
}
