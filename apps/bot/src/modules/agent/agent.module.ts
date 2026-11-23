import { Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ModerationModule } from '../moderation/moderation.module';
import { ModuleManagerModule } from '../module-manager/module-manager.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { AgentService } from './agent.service';
import { SkillService } from './skill.service';
import { SkillBlueprintLibrary } from './skill-blueprint.library';

// Plus de commandes slash agent NI panels à handlers : tout passe par
// l'agent conversationnel (tools discord.* permission-gated en code) et
// le moteur générique de surfaces.
@Module({
  imports: [AuditModule, GuildConfigModule, ModerationModule, ModuleManagerModule, ToolRegistryModule],
  providers: [AgentService, SkillService, SkillBlueprintLibrary],
  exports: [AgentService],
})
export class AgentModule {}
