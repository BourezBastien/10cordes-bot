import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { GuildConfigModule } from '../guild-config/guild-config.module';
import { ModuleManagerModule } from '../module-manager/module-manager.module';
import { ToolRegistryService } from './tool-registry.service';

// @Global : le registry est le hub unique des tools (assistant, agent, dashboard, vocal).
@Global()
@Module({
  imports: [AuditModule, GuildConfigModule, ModuleManagerModule],
  providers: [ToolRegistryService],
  exports: [ToolRegistryService],
})
export class ToolRegistryModule {}
