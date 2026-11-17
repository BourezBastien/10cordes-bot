import { Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ModerationModule } from '../moderation/moderation.module';
import { ModuleManagerModule } from '../module-manager/module-manager.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { AgentService } from './agent.service';
import { SkillService } from './skill.service';
import { AdminWhitelistService } from './whitelist.service';

// Plus de commandes slash agent : tout passe par l'agent conversationnel
// (tools discord.* en exécution directe, permission-gated en code).
@Module({
  imports: [AuditModule, GuildConfigModule, ModerationModule, ModuleManagerModule, ToolRegistryModule],
  providers: [AgentService, AdminWhitelistService, SkillService],
  exports: [AgentService, AdminWhitelistService],
})
export class AgentModule {}
