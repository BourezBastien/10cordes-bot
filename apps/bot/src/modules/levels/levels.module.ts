import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { LevelsService } from './levels.service';
import { LevelsMessageListener } from './levels.listener';

// XP et niveaux passifs (config levels.*, désactivé par défaut) : listener
// XP/message avec cooldown, annonces de level-up, rôles-récompenses,
// tools member.level / server.levels / levels.addXp.
@Module({
  imports: [GuildConfigModule, ToolRegistryModule],
  providers: [LevelsService],
  listeners: [LevelsMessageListener],
})
export class LevelsModule {}
