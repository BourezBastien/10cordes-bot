import { Module } from '@spraxium/common';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { RRSelectHandler } from './roles.command';
import { RolesStatusService } from './roles.status';

@Module({
  imports: [GuildConfigModule, ToolRegistryModule],
  handlers: [RRSelectHandler],
  providers: [RolesStatusService],
})
export class RolesModule {}
