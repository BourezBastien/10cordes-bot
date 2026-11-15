import { Global, Module } from '@spraxium/common';
import { AuditModule } from '../audit/audit.module';
import { ConfigExportHandler } from './handlers/config-export.handler';
import { ConfigImportHandler } from './handlers/config-import.handler';
import { ConfigKeyAutocomplete } from './handlers/config-key.autocomplete';
import { ConfigSetHandler } from './handlers/config-set.handler';
import { ConfigViewHandler } from './handlers/config-view.handler';
import { GuildConfigService } from './guild-config.service';
import { SetupCommand } from '../setup/setup.schema';

// @Global : GuildConfigService est l'infra de configuration partagée par tous les modules.
@Global()
@Module({
  imports: [AuditModule],
  commands: [SetupCommand],
  handlers: [ConfigViewHandler, ConfigSetHandler, ConfigExportHandler, ConfigImportHandler, ConfigKeyAutocomplete],
  providers: [GuildConfigService],
  exports: [GuildConfigService],
})
export class GuildConfigModule {}
