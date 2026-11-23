import type { Guild, GuildMember } from 'discord.js';
import type { AdminOp } from '@10cordes/shared';
import { guildAdminPolicy, guildAccessContext } from './access-policy';
import { memberPermissionPolicy } from './member-permission.policy';
import type { PermissionName } from './permission-name';

/**
 * Policy des opérations d'administration exécutées directement par l'agent
 * (suppression de salon ou de rôle, sanctions). Le registry a déjà vérifié la
 * permission du tool ; on re-vérifie ici la permission SPÉCIFIQUE de l'op,
 * côté demandeur.
 */

/** Permission Discord exigée du DEMANDEUR par type d'op. */
const REQUIRED_PERMISSIONS: Partial<Record<AdminOp['type'], PermissionName>> = {
  'channel.delete': 'ManageChannels',
  'role.delete': 'ManageRoles',
  'member.timeout': 'ModerateMembers',
  'member.kick': 'KickMembers',
  'member.ban': 'BanMembers',
};

const DEFAULT_PERMISSION: PermissionName = 'ManageGuild';

/** Permission exigée du demandeur pour un type d'op (ManageGuild par défaut). */
export function requiredPermissionFor(opType: AdminOp['type']): PermissionName {
  return REQUIRED_PERMISSIONS[opType] ?? DEFAULT_PERMISSION;
}

export class AdminOpPolicy {
  readonly policyName = 'AdminOp';

  /**
   * Le demandeur est propriétaire du serveur ou dispose de la permission
   * exigée par l'op.
   */
  isRequesterAllowed(guild: Guild, requester: GuildMember | null, requesterId: string, opType: AdminOp['type']): boolean {
    if (guildAdminPolicy.isAuthorized(guildAccessContext(guild, requesterId, requester))) return true;
    return memberPermissionPolicy.has(requester, requiredPermissionFor(opType));
  }
}

/** Instance singleton (la policy est sans état). */
export const adminOpPolicy = new AdminOpPolicy();
