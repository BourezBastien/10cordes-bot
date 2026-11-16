import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { ImagelabModule } from '../imagelab/imagelab.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { LocaleModule } from '../locale/locale.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { IaConfigureButtonHandler, IaConfigureModalSubmitHandler } from './handlers/ia-config.handlers';
import { ToolsNextHandler, ToolsPrevHandler } from './handlers/tools-page.handlers';
import { AssistantMentionListener } from './listeners/assistant-mention.listener';
import { AssistantQueue } from './assistant.queue';
import { AssistantService } from './assistant.service';
import { LlmService } from './llm.service';

// @Global : LlmService + AssistantQueue consommés par la santé (HealthController,
// HealthMonitor) fournie au niveau AppModule — sans ça, les exports restent
// confinés au container du premier chargeur transitif.
@Global()
@Module({
  imports: [AuditModule, GuildConfigModule, ImagelabModule, LocaleModule, ToolRegistryModule],
  listeners: [AssistantMentionListener],
  handlers: [IaConfigureButtonHandler, IaConfigureModalSubmitHandler, ToolsPrevHandler, ToolsNextHandler],
  providers: [AssistantQueue, AssistantService, LlmService],
  exports: [LlmService, AssistantQueue],
})
export class AssistantModule {}
