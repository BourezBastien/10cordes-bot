import { SlashCommand, SlashOption, SlashSubcommand } from '@spraxium/common';
import { PermissionFlagsBits } from 'discord.js';

/**
 * Toutes les commandes de modération sous une seule commande racine.
 * Handlers : ModWarnHandler, ModWarningsHandler, ModTimeoutHandler, ModUntimeoutHandler,
 * ModKickHandler, ModBanHandler, ModUnbanHandler, ModPurgeHandler, ModCaseHandler,
 * ModCasesHandler, ModBanInfoHandler, ModMuteInfoHandler, ModDerankHandler, ModRestoreRolesHandler.
 */
@SlashCommand({
  name: 'mod',
  description: 'Moderation commands — warns, cases, sanctions.',
  defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
  dmPermission: false,
})
export class ModCommand {
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
  @SlashOption.User('user', { description: 'Only this member' + "'s messages", required: false })
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
