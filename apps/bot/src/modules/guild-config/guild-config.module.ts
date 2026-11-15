import { Module } from '@spraxium/common';
import { ConfigCommand } from './commands/config.command';
import { ConfigExportHandler } from './handlers/config-export.handler';
import { ConfigImportHandler } from './handlers/config-import.handler';
import { ConfigKeyAutocomplete } from './handlers/config-key.autocomplete';
import { ConfigSetHandler } from './handlers/config-set.handler';
import { ConfigViewHandler } from './handlers/config-view.handler';
import { GuildConfigService } from './guild-config.service';

@Module({
  commands: [ConfigCommand],
  handlers: [ConfigViewHandler, ConfigSetHandler, ConfigExportHandler, ConfigImportHandler, ConfigKeyAutocomplete],
  providers: [GuildConfigService],
  exports: [GuildConfigService],
})
export class GuildConfigModule {}
