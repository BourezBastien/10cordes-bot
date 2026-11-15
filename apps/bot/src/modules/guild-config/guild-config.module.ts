import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { GuildConfigService } from './guild-config.service';

// @Global : GuildConfigService est l'infra de configuration partagée par tous les modules.
// La config se règle via le dashboard /setup (config avancée) ou l'agent (config.set).
@Global()
@Module({
  imports: [AuditModule],
  providers: [GuildConfigService],
  exports: [GuildConfigService],
})
export class GuildConfigModule {}
