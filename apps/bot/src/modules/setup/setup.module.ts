import { Module } from '@spraxium/common';
import { AssistantModule } from '../assistant/assistant.module';
import { AuditModule } from '../audit/audit.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ImagelabModule } from '../imagelab/imagelab.module';
import { ModuleManagerModule } from '../module-manager/module-manager.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { SetupPanelButtonHandler } from './setup.handlers';
import {
  SetupAssistantClearHandler,
  SetupBackHandler,
  SetupCategoryHandler,
  SetupConfigKeyHandler,
  SetupConfigValueHandler,
  SetupLanguageHandler,
  SetupLevelsChannelHandler,
  SetupLevelsToggleHandler,
  SetupLogsCatHandler,
  SetupLogsChannelHandler,
  SetupModChannelHandler,
  SetupModDerankHandler,
  SetupModulesDisableHandler,
  SetupModulesEnableHandler,
  SetupModulesPickHandler,
  SetupRolesAddHandler,
  SetupRolesChannelHandler,
  SetupRolesPostHandler,
  SetupRolesRefreshHandler,
  SetupTicketsCategoryHandler,
  SetupTicketsLogsHandler,
  SetupTicketsPanelHandler,
  SetupTicketsPostHandler,
  SetupTicketsStaffHandler,
  SetupWelcomeAutoroleHandler,
  SetupWelcomeChannelHandler,
  SetupWelcomeDeleteLeaveHandler,
  SetupWelcomeToggleHandler,
} from './setup.handlers';

@Module({
  imports: [
    AssistantModule,
    AuditModule,
    GuildConfigModule,
    ImagelabModule,
    ModuleManagerModule,
    ToolRegistryModule,
  ],
  handlers: [
    SetupPanelButtonHandler,
    SetupCategoryHandler,
    SetupBackHandler,
    SetupModulesPickHandler,
    SetupModulesEnableHandler,
    SetupModulesDisableHandler,
    SetupWelcomeChannelHandler,
    SetupWelcomeAutoroleHandler,
    SetupWelcomeToggleHandler,
    SetupWelcomeDeleteLeaveHandler,
    SetupLogsCatHandler,
    SetupLogsChannelHandler,
    SetupTicketsCategoryHandler,
    SetupTicketsStaffHandler,
    SetupTicketsPanelHandler,
    SetupTicketsLogsHandler,
    SetupTicketsPostHandler,
    SetupRolesAddHandler,
    SetupRolesChannelHandler,
    SetupRolesPostHandler,
    SetupRolesRefreshHandler,
    SetupLevelsToggleHandler,
    SetupLevelsChannelHandler,
    SetupModChannelHandler,
    SetupModDerankHandler,
    SetupConfigKeyHandler,
    SetupConfigValueHandler,
    SetupLanguageHandler,
    SetupAssistantClearHandler,
  ],
})
export class SetupModule {}
