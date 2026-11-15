import { Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ModuleManagerModule } from '../module-manager/module-manager.module';
import { ToolRegistryService } from './tool-registry.service';

@Module({
  imports: [AuditModule, GuildConfigModule, ModuleManagerModule],
  providers: [ToolRegistryService],
  exports: [ToolRegistryService],
})
export class ToolRegistryModule {}
