import { Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { ImagelabModule } from '../imagelab/imagelab.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { LocaleModule } from '../locale/locale.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { IaConfigureButtonHandler, IaConfigureModalSubmitHandler } from './handlers/ia-config.handlers';
import { AssistantMentionListener } from './listeners/assistant-mention.listener';
import { AssistantQueue } from './assistant.queue';
import { AssistantService } from './assistant.service';
import { LlmService } from './llm.service';

@Module({
  imports: [AuditModule, GuildConfigModule, ImagelabModule, LocaleModule, ToolRegistryModule],
  listeners: [AssistantMentionListener],
  handlers: [IaConfigureButtonHandler, IaConfigureModalSubmitHandler],
  providers: [AssistantQueue, AssistantService, LlmService],
  exports: [LlmService],
})
export class AssistantModule {}
