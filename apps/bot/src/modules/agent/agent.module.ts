import { Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ModerationModule } from '../moderation/moderation.module';
import { ModuleManagerModule } from '../module-manager/module-manager.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { AgentApproveHandler, AgentCancelHandler } from './components/agent-buttons.handler';
import { AgentService } from './agent.service';
import { SkillService } from './skill.service';
import { AdminWhitelistService } from './whitelist.service';

// Plus de commandes slash agent : propose/approve passent par l'agent conversationnel
// (tools discord.* créent les plans) et les boutons de validation.
@Module({
  imports: [AuditModule, GuildConfigModule, ModerationModule, ModuleManagerModule, ToolRegistryModule],
  handlers: [AgentApproveHandler, AgentCancelHandler],
  providers: [AgentService, AdminWhitelistService, SkillService],
  exports: [AgentService, AdminWhitelistService],
})
export class AgentModule {}
