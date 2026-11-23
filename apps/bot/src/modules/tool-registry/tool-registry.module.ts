import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ModuleManagerModule } from '../module-manager/module-manager.module';
import { CacheModule } from '../../shared/cache/cache.module';
import { ToolRegistryService } from './tool-registry.service';

/**
 * @Global : le registry est le hub unique des tools. Ses dépendances runtime
 * (prisma, client, cache, rendu de surface) sont liées par
 * ToolRegistryService.onBoot et les RÈGLES par GuildRulesService.onBoot.
 * Les cycles DI sont cassés par accesseurs plutôt que par imports croisés.
 *
 * Rien dans la classe : le framework n'instancie PAS les modules (seuls
 * providers/listeners/handlers ont un cycle de vie).
 */
@Global()
@Module({
  imports: [AuditModule, CacheModule, DatabaseModule, GuildConfigModule, ModuleManagerModule],
  providers: [ToolRegistryService],
  exports: [ToolRegistryService],
})
export class ToolRegistryModule {}
