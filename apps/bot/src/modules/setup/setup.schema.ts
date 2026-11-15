import { SlashCommand, SlashOption, SlashSubcommand, SlashSubcommandGroup, SlashSubcommandGroups } from '@spraxium/common';
import { PermissionFlagsBits } from 'discord.js';

/**
 * PANNEAU DE CONTRÔLE UNIQUE — une seule commande racine `/setup`, une catégorie
 * (groupe de sous-commandes) par domaine : dashboard, modules, configure, config,
 * audit, logs, moderation, roles, tickets, agent.
 * Les handlers vivent dans leur module d'origine et pointent vers SetupCommand
 * via @SlashCommandHandler(SetupCommand, { group, sub }).
 */

@SlashSubcommandGroup({ name: 'modules', description: 'Enable/disable the bot feature modules' })
export class ModulesGroup {
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

@SlashSubcommandGroup({ name: 'config', description: 'Server configuration document (typed JSON)' })
export class ConfigGroup {
  @SlashOption.String('key', { description: 'Config key', required: false, autocomplete: true })
  @SlashSubcommand({ name: 'view', description: 'View a config key, or the whole document.' })
  view() {}

  @SlashOption.String('key', { description: 'Config key', required: true, autocomplete: true })
  @SlashOption.String('value', { description: 'New value — true/false, number, JSON or raw text', required: true })
  @SlashSubcommand({ name: 'set', description: 'Set a config value.' })
  set() {}

  @SlashSubcommand({ name: 'export', description: 'Export this guild config as a JSON file.' })
  export() {}

  @SlashOption.Attachment('file', { description: 'JSON file produced by /setup config export', required: true })
  @SlashSubcommand({ name: 'import', description: 'Replace this guild config from a JSON file.' })
  import() {}
}

const AUDIT_SOURCE_CHOICES = [
  { name: 'discord', value: 'discord' },
  { name: 'api', value: 'api' },
  { name: 'agent', value: 'agent' },
  { name: 'system', value: 'system' },
];

@SlashSubcommandGroup({ name: 'audit', description: 'Audit log — who did what, when' })
export class AuditGroup {
  @SlashOption.String('source', { description: 'Filter by source', required: false, choices: AUDIT_SOURCE_CHOICES })
  @SlashOption.Integer('limit', { description: 'Max entries (1-25)', required: false })
  @SlashSubcommand({ name: 'recent', description: 'Recent audit entries.' })
  recent() {}

  @SlashOption.String('source', { description: 'Filter by source', required: false, choices: AUDIT_SOURCE_CHOICES })
  @SlashSubcommand({ name: 'stats', description: 'Audit counts by action.' })
  stats() {}
}

const LOG_CATEGORY_CHOICES = [
  { name: 'messages', value: 'messages' },
  { name: 'members', value: 'members' },
  { name: 'voice', value: 'voice' },
  { name: 'moderation', value: 'moderation' },
  { name: 'server', value: 'server' },
];

@SlashSubcommandGroup({ name: 'logs', description: 'Route log categories to channels' })
export class LogsGroup {
  @SlashOption.String('category', { description: 'Log category', required: true, choices: LOG_CATEGORY_CHOICES })
  @SlashOption.Channel('channel', { description: 'Channel receiving these logs', required: true })
  @SlashSubcommand({ name: 'set', description: 'Route a log category to a channel.' })
  set() {}

  @SlashOption.String('category', { description: 'Log category', required: true, choices: LOG_CATEGORY_CHOICES })
  @SlashSubcommand({ name: 'clear', description: 'Disable a log category.' })
  clear() {}

  @SlashOption.Role('role', { description: 'Role to exclude from role logs', required: true })
  @SlashSubcommand({ name: 'ignore-role', description: 'Toggle a role exclusion in role logs.' })
  ignoreRole() {}

  @SlashSubcommand({ name: 'view', description: 'View the current log configuration.' })
  view() {}
}

@SlashSubcommandGroup({ name: 'moderation', description: 'Warns, cases and sanctions' })
export class ModerationGroup {
  @SlashOption.User('user', { description: 'Member to warn', required: true })
  @SlashOption.String('reason', { description: 'Reason (sent to the member)', required: true })
  @SlashSubcommand({ name: 'warn', description: 'Warn a member.' })
  warn() {}

  @SlashOption.User('user', { description: 'Member', required: true })
  @SlashSubcommand({ name: 'warnings', description: 'List the warnings of a member.' })
  warnings() {}

  @SlashOption.User('user', { description: 'Member to timeout', required: true })
  @SlashOption.String('duration', { description: 'Duration — e.g. 10m, 1h, 3d', required: true })
  @SlashOption.String('reason', { description: 'Reason', required: false })
  @SlashSubcommand({ name: 'timeout', description: 'Temporarily mute a member.' })
  timeout() {}

  @SlashOption.User('user', { description: 'Member', required: true })
  @SlashOption.String('reason', { description: 'Reason', required: false })
  @SlashSubcommand({ name: 'untimeout', description: 'Remove the timeout of a member.' })
  untimeout() {}

  @SlashOption.User('user', { description: 'Member to kick', required: true })
  @SlashOption.String('reason', { description: 'Reason', required: false })
  @SlashSubcommand({ name: 'kick', description: 'Kick a member.' })
  kick() {}

  @SlashOption.User('user', { description: 'User to ban', required: true })
  @SlashOption.String('reason', { description: 'Reason', required: false })
  @SlashOption.Boolean('purge_messages', { description: 'Also delete their last 24h of messages', required: false })
  @SlashSubcommand({ name: 'ban', description: 'Ban a user.' })
  ban() {}

  @SlashOption.String('user_id', { description: 'Discord ID of the banned user', required: true })
  @SlashOption.String('reason', { description: 'Reason', required: false })
  @SlashSubcommand({ name: 'unban', description: 'Unban a user by ID.' })
  unban() {}

  @SlashOption.Integer('count', { description: 'Messages to delete (1-100)', required: true })
  @SlashOption.User('user', { description: "Only this member's messages", required: false })
  @SlashSubcommand({ name: 'purge', description: 'Bulk-delete recent messages.' })
  purge() {}

  @SlashOption.Integer('case', { description: 'Case number', required: true })
  @SlashSubcommand({ name: 'case', description: 'Show one moderation case.' })
  case() {}

  @SlashOption.User('user', { description: 'Filter by member', required: false })
  @SlashSubcommand({ name: 'cases', description: 'List recent moderation cases.' })
  cases() {}

  @SlashOption.User('user', { description: 'Banned user', required: true })
  @SlashSubcommand({ name: 'baninfo', description: 'Show ban details for a member.' })
  baninfo() {}

  @SlashOption.User('user', { description: 'Timed-out member', required: true })
  @SlashSubcommand({ name: 'muteinfo', description: 'Show timeout details for a member.' })
  muteinfo() {}

  @SlashOption.User('user', { description: 'Member to derank', required: true })
  @SlashOption.String('reason', { description: 'Reason', required: false })
  @SlashSubcommand({ name: 'derank', description: 'Remove all roles (a backup is stored).' })
  derank() {}

  @SlashOption.User('user', { description: 'Member to restore', required: true })
  @SlashSubcommand({ name: 'restoreroles', description: 'Restore roles from the last backup.' })
  restoreroles() {}
}

@SlashSubcommandGroup({ name: 'roles', description: 'Self-serve role menu' })
export class RolesGroup {
  @SlashOption.Role('role', { description: 'Role offered in the menu', required: true })
  @SlashSubcommand({ name: 'add', description: 'Add a role to the menu options.' })
  add() {}

  @SlashOption.Role('role', { description: 'Role to remove', required: true })
  @SlashSubcommand({ name: 'remove', description: 'Remove a role from the menu options.' })
  remove() {}

  @SlashOption.Channel('channel', { description: 'Channel to post the role menu', required: true })
  @SlashSubcommand({ name: 'post', description: 'Post (or move) the role menu in a channel.' })
  post() {}

  @SlashSubcommand({ name: 'refresh', description: 'Edit the posted menu with the current options.' })
  refresh() {}

  @SlashSubcommand({ name: 'view', description: 'View the current role menu options.' })
  view() {}
}

@SlashSubcommandGroup({ name: 'tickets', description: 'Ticket system setup' })
export class TicketsGroup {
  @SlashOption.Channel('channel', { description: 'Category containing ticket channels', required: true })
  @SlashSubcommand({ name: 'category', description: 'Set the category where tickets are created.' })
  category() {}

  @SlashOption.Role('role', { description: 'Staff role (claim/close)', required: true })
  @SlashSubcommand({ name: 'staff', description: 'Set the staff role.' })
  staff() {}

  @SlashOption.Channel('channel', { description: 'Channel receiving the open panel', required: true })
  @SlashSubcommand({ name: 'panel', description: 'Set the channel receiving the open panel.' })
  panel() {}

  @SlashOption.Channel('channel', { description: 'Channel receiving transcripts', required: true })
  @SlashSubcommand({ name: 'logs', description: 'Set the transcripts channel.' })
  logs() {}

  @SlashSubcommand({ name: 'setup', description: 'Post the ticket panel in the configured channel.' })
  setup() {}
}

@SlashSubcommandGroup({ name: 'agent', description: 'Agent Admin — plans confirmed by humans' })
export class AgentGroup {
  @SlashOption.User('user', { description: 'User allowed to approve destructive plans', required: true })
  @SlashSubcommand({ name: 'whitelist-add', description: 'Owner only — whitelist a user for destructive plans.' })
  whitelistAdd() {}

  @SlashOption.User('user', { description: 'User to remove', required: true })
  @SlashSubcommand({ name: 'whitelist-remove', description: 'Owner only — remove a user from the whitelist.' })
  whitelistRemove() {}

  @SlashSubcommand({ name: 'whitelist', description: 'List users allowed to approve destructive plans.' })
  whitelist() {}

  @SlashOption.String('ops', { description: 'Plan as JSON — {"title":…,"ops":[{"type":…}]}', required: true })
  @SlashSubcommand({ name: 'propose', description: 'Propose a plan of actions (validated, then confirmed by humans).' })
  propose() {}

  @SlashSubcommand({ name: 'plans', description: 'List pending plans in this channel.' })
  plans() {}
}

/**
 * Commande racine unique : le dashboard de gestion du serveur.
 * Les 4 autres commandes publiques : /rank, /leaderboard, /language, /tag.
 */
@SlashSubcommandGroups([
  ModulesGroup,
  ConfigureGroup,
  ConfigGroup,
  AuditGroup,
  LogsGroup,
  ModerationGroup,
  RolesGroup,
  TicketsGroup,
  AgentGroup,
])
@SlashCommand({
  name: 'setup',
  description: 'Control panel — modules, moderation, tickets, roles, logs, config, audit, agent.',
  defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  dmPermission: false,
})
export class SetupCommand {
  @SlashSubcommand({ name: 'dashboard', description: 'Open the interactive control panel.' })
  dashboard() {}
}
