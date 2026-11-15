import { Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ModerationModule } from '../moderation/moderation.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { AgentCommand, AgentPlansHandler, AgentProposeHandler, AgentWhitelistAddHandler, AgentWhitelistHandler, AgentWhitelistRemoveHandler } from './commands/agent.command';
import { AgentApproveHandler, AgentCancelHandler } from './components/agent-buttons.handler';
import { AgentService } from './agent.service';
import { AdminWhitelistService } from './whitelist.service';

@Module({
  imports: [AuditModule, GuildConfigModule, ModerationModule, ToolRegistryModule],
  commands: [AgentCommand],
  handlers: [
    AgentWhitelistAddHandler,
    AgentWhitelistRemoveHandler,
    AgentWhitelistHandler,
    AgentProposeHandler,
    AgentPlansHandler,
    AgentApproveHandler,
    AgentCancelHandler,
  ],
  providers: [AgentService, AdminWhitelistService],
  exports: [AgentService, AdminWhitelistService],
})
export class AgentModule {}
