import { Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { GuildModuleStateService } from './guild-module-state.service';
import { ModuleManagerService } from './module-manager.service';

// Gestion des modules : toggles par serveur (dashboard + tools agent
// getModules/enableModule/disableModule).
@Module({
  imports: [AuditModule],
  providers: [ModuleManagerService, GuildModuleStateService],
  exports: [ModuleManagerService, GuildModuleStateService],
})
export class ModuleManagerModule {}
