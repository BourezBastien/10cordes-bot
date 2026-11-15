import { Module } from '@spraxium/common';
import { ConfigureGroup, ModulesCommand } from './commands/modules.command';
import { ConfigureChannelAddHandler, ConfigureChannelRemoveHandler, ConfigureViewHandler } from './handlers/configure-channels.handler';
import { ConfigureBypassToggleHandler, ConfigureCooldownSetHandler, ConfigureQuotaRemoveHandler, ConfigureQuotaSetHandler } from './handlers/configure-limits.handler';
import { ConfigureRoleClearHandler, ConfigureRoleSetHandler } from './handlers/configure-roles.handler';
import { ModulesDisableHandler } from './handlers/modules-disable.handler';
import { ModulesEnableHandler } from './handlers/modules-enable.handler';
import { ModulesListHandler } from './handlers/modules-list.handler';
import { ModulesModuleAutocomplete } from './handlers/modules-module.autocomplete';
import { CooldownService } from './cooldown.service';
import { GuildModuleStateService } from './guild-module-state.service';
import { ModuleManagerService } from './module-manager.service';

@Module({
  commands: [ModulesCommand],
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
