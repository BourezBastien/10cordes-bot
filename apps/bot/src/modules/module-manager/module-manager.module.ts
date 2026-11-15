import { Global, Module } from '@spraxium/common';
import { ConfigureChannelAddHandler, ConfigureChannelRemoveHandler, ConfigureViewHandler } from './handlers/configure-channels.handler';
import { ConfigureBypassToggleHandler, ConfigureCooldownSetHandler, ConfigureQuotaRemoveHandler, ConfigureQuotaSetHandler } from './handlers/configure-limits.handler';
import { ConfigureRoleClearHandler, ConfigureRoleSetHandler } from './handlers/configure-roles.handler';
import { ModulesDisableHandler } from './handlers/modules-disable.handler';
import { ModulesEnableHandler } from './handlers/modules-enable.handler';
import { ModulesListHandler } from './handlers/modules-list.handler';
import { ModulesModuleAutocomplete } from './handlers/modules-module.autocomplete';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { CooldownService } from './cooldown.service';
import { GuildModuleStateService } from './guild-module-state.service';
import { ModuleManagerService } from './module-manager.service';
import { SetupCommand } from '../setup/setup.schema';

// @Global : ModuleManagerService/GuildModuleStateService/CooldownService sont de
// l'infra partagée (guard pipeline, agent, controllers) — sans Global, un chargement
// transitif (ex. via ToolRegistry) confinerait leurs exports au container du chargeur.
@Global()
@Module({
  imports: [AuditModule],
  commands: [SetupCommand],
  handlers: [
    ModulesListHandler,
    ModulesEnableHandler,
    ModulesDisableHandler,
    ModulesModuleAutocomplete,
    ConfigureViewHandler,
    ConfigureChannelAddHandler,
    ConfigureChannelRemoveHandler,
    ConfigureRoleSetHandler,
    ConfigureRoleClearHandler,
    ConfigureCooldownSetHandler,
    ConfigureQuotaSetHandler,
    ConfigureQuotaRemoveHandler,
    ConfigureBypassToggleHandler,
  ],
  providers: [ModuleManagerService, GuildModuleStateService, CooldownService],
  exports: [ModuleManagerService, GuildModuleStateService, CooldownService],
})
export class ModuleManagerModule {}
