import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { RolesAddHandler, RolesCommand, RolesPostHandler, RolesRefreshHandler, RolesRemoveHandler, RolesViewHandler, RRSelectHandler } from './roles.command';

@Module({
  imports: [GuildConfigModule],
  commands: [RolesCommand],
  handlers: [RolesAddHandler, RolesRemoveHandler, RolesPostHandler, RolesRefreshHandler, RolesViewHandler, RRSelectHandler],
})
export class RolesModule {}
