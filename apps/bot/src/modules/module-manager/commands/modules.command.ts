import { SlashCommand, SlashOption, SlashSubcommand, SlashSubcommandGroup, SlashSubcommandGroups } from '@spraxium/common';
import { PermissionFlagsBits } from 'discord.js';

// Handlers racine : ModulesListHandler, ModulesEnableHandler, ModulesDisableHandler.
// Groupe configure : Configure*Handler (whitelists, cooldowns, quotas).
// Autocomplétion du nom de module : ModulesModuleAutocomplete.
@SlashSubcommandGroup({ name: 'configure', description: 'Whitelists, cooldowns and quotas per server' })
export class ConfigureGroup {
  @SlashOption.String('module', { description: 'Module to configure', required: true, autocomplete: true })
  @SlashSubcommand({ name: 'view', description: 'View the module constraints on this server.' })
  view() {}

  @SlashOption.String('module', { description: 'Module', required: true, autocomplete: true })
  @SlashOption.Channel('channel', { description: 'Channel to allow', required: true })
  @SlashSubcommand({ name: 'channel-add', description: 'Add a channel to the module whitelist.' })
  channelAdd() {}

  @SlashOption.String('module', { description: 'Module', required: true, autocomplete: true })
  @SlashOption.Channel('channel', { description: 'Channel to remove', required: true })
  @SlashSubcommand({ name: 'channel-remove', description: 'Remove a channel from the module whitelist.' })
  channelRemove() {}

  @SlashOption.String('module', { description: 'Module', required: true, autocomplete: true })
  @SlashOption.Role('role', { description: 'Role required to use the module', required: true })
  @SlashSubcommand({ name: 'role-set', description: 'Require a role to use the module.' })
  roleSet() {}

  @SlashOption.String('module', { description: 'Module', required: true, autocomplete: true })
  @SlashSubcommand({ name: 'role-clear', description: 'Remove the required role.' })
  roleClear() {}

  @SlashOption.String('module', { description: 'Module', required: true, autocomplete: true })
  @SlashOption.String('duration', { description: 'Cooldown per user — e.g. 5s, 2m, 1h', required: true })
  @SlashSubcommand({ name: 'cooldown-set', description: 'Set a per-user cooldown for the module.' })
  cooldownSet() {}

  @SlashOption.String('module', { description: 'Module', required: true, autocomplete: true })
  @SlashOption.Role('role', { description: 'Role subject to the quota', required: true })
  @SlashOption.Integer('max', { description: 'Max actions in the window', required: true })
  @SlashOption.String('window', { description: 'Sliding window — e.g. 30m, 1h', required: true })
  @SlashSubcommand({ name: 'quota-set', description: 'Set a mod quota for a role.' })
  quotaSet() {}

  @SlashOption.String('module', { description: 'Module', required: true, autocomplete: true })
  @SlashOption.Role('role', { description: 'Role to free from the quota', required: true })
  @SlashSubcommand({ name: 'quota-remove', description: 'Remove the quota of a role.' })
  quotaRemove() {}

  @SlashOption.String('module', { description: 'Module', required: true, autocomplete: true })
  @SlashSubcommand({ name: 'bypass-toggle', description: 'Toggle the admin bypass for cooldowns/quotas.' })
  bypassToggle() {}
}

@SlashSubcommandGroups([ConfigureGroup])
@SlashCommand({
  name: 'modules',
  description: 'Manage bot feature modules at runtime.',
  defaultMemberPermissions: PermissionFlagsBits.Administrator,
})
export class ModulesCommand {
  @SlashOption.String('scope', {
    description: 'Apply to this server or the whole bot',
    required: false,
    choices: [
      { name: 'Ce serveur', value: 'guild' },
      { name: 'Global (bot entier)', value: 'global' },
    ],
  })
  @SlashSubcommand({ name: 'list', description: 'List modules and their current state.' })
  list() {}

  @SlashOption.String('module', { description: 'Module to enable', required: true, autocomplete: true })
  @SlashOption.String('scope', {
    description: 'Apply to this server or the whole bot',
    required: false,
    choices: [
      { name: 'Ce serveur', value: 'guild' },
      { name: 'Global (bot entier)', value: 'global' },
    ],
  })
  @SlashSubcommand({ name: 'enable', description: 'Enable a module (dependencies are enabled too).' })
  enable() {}

  @SlashOption.String('module', { description: 'Module to disable', required: true, autocomplete: true })
  @SlashOption.String('scope', {
    description: 'Apply to this server or the whole bot',
    required: false,
    choices: [
      { name: 'Ce serveur', value: 'guild' },
      { name: 'Global (bot entier)', value: 'global' },
    ],
  })
  @SlashOption.Boolean('confirm', {
    description: 'Confirm the dependency cascade listed by the previous call',
    required: false,
  })
  @SlashSubcommand({ name: 'disable', description: 'Disable a module (shows dependent cascade first).' })
  disable() {}
}
