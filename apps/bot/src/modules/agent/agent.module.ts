import { Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ModerationModule } from '../moderation/moderation.module';
import { ModuleManagerModule } from '../module-manager/module-manager.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { AgentPlansHandler, AgentProposeHandler, AgentWhitelistAddHandler, AgentWhitelistHandler, AgentWhitelistRemoveHandler } from './commands/agent.command';
import { AgentApproveHandler, AgentCancelHandler } from './components/agent-buttons.handler';
import { AgentService } from './agent.service';
import { AdminWhitelistService } from './whitelist.service';
import { SetupCommand } from '../setup/setup.schema';

@Module({
  imports: [AuditModule, GuildConfigModule, ModerationModule, ModuleManagerModule, ToolRegistryModule],
  commands: [SetupCommand],
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
