import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { GuildMemberAddListener } from './listeners/guild-member-add.listener';
import { GuildMemberRemoveListener } from './listeners/guild-member-remove.listener';
import { WelcomeStatusService } from './welcome.status';

@Module({
  imports: [GuildConfigModule, ToolRegistryModule],
  listeners: [GuildMemberAddListener, GuildMemberRemoveListener],
  providers: [WelcomeStatusService],
})
export class WelcomeModule {}
