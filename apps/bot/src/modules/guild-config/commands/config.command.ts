import { SlashCommand, SlashOption, SlashSubcommand } from '@spraxium/common';
import { PermissionFlagsBits } from 'discord.js';

// Handlers : ConfigViewHandler, ConfigSetHandler, ConfigExportHandler, ConfigImportHandler.
// Autocomplétion des clés : ConfigKeyAutocomplete.
@SlashCommand({
  name: 'config',
  description: 'View or edit the server configuration.',
  defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  dmPermission: false,
})
export class ConfigCommand {
  @SlashOption.String('key', { description: 'Config key', required: false, autocomplete: true })
  @SlashSubcommand({ name: 'view', description: 'View a config key, or the whole document.' })
  view() {}

  @SlashOption.String('key', { description: 'Config key', required: true, autocomplete: true })
  @SlashOption.String('value', { description: 'New value — true/false, number, JSON or raw text', required: true })
  @SlashSubcommand({ name: 'set', description: 'Set a config value.' })
  set() {}

  @SlashSubcommand({ name: 'export', description: 'Export this guild config as a JSON file.' })
  export() {}

  @SlashOption.Attachment('file', { description: 'JSON file produced by /config export', required: true })
  @SlashSubcommand({ name: 'import', description: 'Replace this guild config from a JSON file.' })
  import() {}
}
