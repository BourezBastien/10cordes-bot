import { Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { LocaleModule } from '../locale/locale.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { AssistantMentionListener } from './listeners/assistant-mention.listener';
import { AssistantService } from './assistant.service';
import { LlmService } from './llm.service';

@Module({
  imports: [AuditModule, GuildConfigModule, LocaleModule, ToolRegistryModule],
  listeners: [AssistantMentionListener],
  providers: [AssistantService, LlmService],
  exports: [LlmService],
})
export class AssistantModule {}
