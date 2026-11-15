import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { RolesAddHandler, RolesPostHandler, RolesRefreshHandler, RolesRemoveHandler, RolesViewHandler, RRSelectHandler } from './roles.command';
import { SetupCommand } from '../setup/setup.schema';

@Module({
  imports: [GuildConfigModule],
  commands: [SetupCommand],
  handlers: [RolesAddHandler, RolesRemoveHandler, RolesPostHandler, RolesRefreshHandler, RolesViewHandler, RRSelectHandler],
})
export class RolesModule {}
