import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { MessageXpListener } from './listeners/message-xp.listener';
import { LevelsService } from './levels.service';

@Module({
  imports: [GuildConfigModule, ToolRegistryModule],
  listeners: [MessageXpListener],
  providers: [LevelsService],
  exports: [LevelsService],
})
export class LevelsModule {}
