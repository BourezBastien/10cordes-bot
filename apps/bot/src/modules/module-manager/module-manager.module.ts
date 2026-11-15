import { Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { CooldownService } from './cooldown.service';
import { GuildModuleStateService } from './guild-module-state.service';
import { ModuleManagerService } from './module-manager.service';

// Gestion des modules : dashboard /setup (catégorie Modules) et tools agent
// (modules.list/enable/disable). Plus de commandes slash dédiées.
@Module({
  imports: [AuditModule],
  providers: [ModuleManagerService, GuildModuleStateService, CooldownService],
  exports: [ModuleManagerService, GuildModuleStateService, CooldownService],
})
export class ModuleManagerModule {}
