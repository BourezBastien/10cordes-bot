import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { GuildMemberAddListener } from './listeners/guild-member-add.listener';
import { GuildMemberRemoveListener } from './listeners/guild-member-remove.listener';

@Module({
  imports: [GuildConfigModule],
  listeners: [GuildMemberAddListener, GuildMemberRemoveListener],
})
export class WelcomeModule {}
