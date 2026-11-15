import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { RolesAddHandler, RolesPostHandler, RolesRefreshHandler, RolesRemoveHandler, RolesViewHandler, RRSelectHandler } from './roles.command';
import { RolesStatusService } from './roles.status';
import { SetupCommand } from '../setup/setup.schema';

@Module({
  imports: [GuildConfigModule, ToolRegistryModule],
  commands: [SetupCommand],
  handlers: [RolesAddHandler, RolesRemoveHandler, RolesPostHandler, RolesRefreshHandler, RolesViewHandler, RRSelectHandler],
  providers: [RolesStatusService],
})
export class RolesModule {}
