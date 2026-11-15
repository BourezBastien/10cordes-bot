import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { LeaderboardCommand, LeaderboardHandler, RankCommand, RankHandler } from './levels.command';
import { MessageXpListener } from './listeners/message-xp.listener';
import { LevelsService } from './levels.service';

@Module({
  imports: [GuildConfigModule],
  commands: [RankCommand, LeaderboardCommand],
  handlers: [RankHandler, LeaderboardHandler],
  listeners: [MessageXpListener],
  providers: [LevelsService],
  exports: [LevelsService],
})
export class LevelsModule {}
