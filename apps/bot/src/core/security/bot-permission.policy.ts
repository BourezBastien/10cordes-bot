import type { Guild, GuildBasedChannel, GuildChannel } from 'discord.js';
import { permissionFlag, type PermissionName } from './permission-name';

/**
 * Policy « le BOT a-t-il le droit ? ». Seul endroit du code qui interroge les
 * permissions du membre du bot ; tout le monde lui demande par NOM de
 * permission.
 *
 * - `canInGuild` / `assertCanInGuild` : permission dans le serveur ;
 * - `canAllInChannel` / `assertCanAllInChannel` : TOUTES les permissions
 *   listées dans un salon (overwrites pris en compte par discord.js) ;
 * - `isDeniedToEveryone` : lecture d'un overwrite (l'état d'un salon, pas une
 *   décision d'accès).
 */

export type PermissionScope = 'guild' | 'channel';

/** Erreur domaine : le bot n'a pas une permission requise. */
export class BotMissingPermissionError extends Error {
  constructor(
    public readonly permission: string,
    public readonly scope: PermissionScope,
  ) {
    super(
      scope === 'guild'
        ? `Le bot n\u0027a pas la permission ${permission} sur ce serveur.`
        : `Le bot n\u0027a pas la permission ${permission} dans ce salon.`,
    );
    this.name = 'BotMissingPermissionError';
  }
}

export class BotPermissionPolicy {
  readonly policyName = 'BotPermission';

  /** Le bot dispose de la permission dans le serveur. */
  canInGuild(guild: Guild, permission: PermissionName): boolean {
    return guild.members.me?.permissions.has(permissionFlag(permission)) ?? false;
  }

  assertCanInGuild(guild: Guild, permission: PermissionName): void {
    if (!this.canInGuild(guild, permission)) throw new BotMissingPermissionError(permission, 'guild');
  }

  /** Le bot dispose de TOUTES les permissions listées dans ce salon. */
  canAllInChannel(channel: GuildBasedChannel | null | undefined, permissions: readonly PermissionName[]): boolean {
    if (!channel || !channel.guild) return false;
    const mine = channel.guild.members.me;
    if (!mine) return false;
    const overwrites = channel.permissionsFor(mine);
    if (!overwrites) return false;
    return permissions.every((permission) => overwrites.has(permissionFlag(permission)));
  }

  assertCanAllInChannel(channel: GuildBasedChannel | null | undefined, permissions: readonly PermissionName[]): void {
    const missing = permissions.filter((permission) => !this.canAllInChannel(channel, [permission]));
    if (missing.length > 0) throw new BotMissingPermissionError(missing.join(', '), 'channel');
  }

  /** L'overwrite `@everyone` du salon refuse-t-il cette permission ? */
  isDeniedToEveryone(channel: GuildChannel | null | undefined, permission: PermissionName): boolean {
    if (!channel) return false;
    return channel.permissionOverwrites.cache.get(channel.guildId)?.deny.has(permissionFlag(permission)) ?? false;
  }

  /**
   * Le rôle est-il au-dessus du bot (hiérarchie) ? Vrai = le bot ne peut ni
   * le donner ni le retirer, même avec ManageRoles.
   */
  isRoleAboveBot(guild: Guild, role: { position: number }): boolean {
    return role.position >= (guild.members.me?.roles.highest.position ?? role.position);
  }

  /** Refus lisible, pour les résultats de tools et d'opérations. */
  refusal(permission: string, scope: PermissionScope = 'guild'): string {
    return new BotMissingPermissionError(permission, scope).message;
  }
}

/** Instance singleton (la policy est sans état). */
export const botPermissionPolicy = new BotPermissionPolicy();
