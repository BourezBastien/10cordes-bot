import type { GuildMember } from 'discord.js';
import { permissionFlag, type PermissionName } from './permission-name';

/**
 * Policy « ce MEMBRE a-t-il le droit ? ». Administrator ouvre toutes les
 * permissions ; un membre absent du cache n'a rien.
 */

export class MemberPermissionPolicy {
  readonly policyName = 'MemberPermission';

  /** Le membre est-il administrateur du serveur ? */
  isAdmin(member: GuildMember | null | undefined): boolean {
    return member?.permissions.has(permissionFlag('Administrator')) ?? false;
  }

  /** Le membre dispose de la permission (ou est administrateur). */
  has(member: GuildMember | null | undefined, permission: PermissionName): boolean {
    if (!member) return false;
    return this.isAdmin(member) || member.permissions.has(permissionFlag(permission));
  }

  /** Le membre dispose d'AU MOINS UNE des permissions listées (ou est administrateur). */
  hasAny(member: GuildMember | null | undefined, permissions: readonly PermissionName[]): boolean {
    return permissions.some((permission) => this.has(member, permission));
  }

  /**
   * Le membre dispose de TOUTES ces permissions, désignées par leur NOM et
   * chargées telles quelles d'une définition (permissions requises d'un
   * binding de surface). Un nom inconnu n'est jamais accordé.
   */
  hasAllNames(member: GuildMember | null | undefined, permissionNames: readonly string[]): boolean {
    if (!member) return false;
    if (this.isAdmin(member)) return true;
    const granted: ReadonlySet<string> = new Set(member.permissions.toArray());
    return permissionNames.every((permission) => granted.has(permission));
  }

  /** Le membre porte-t-il ce rôle ? */
  hasRole(member: GuildMember | null | undefined, roleId: string): boolean {
    return member?.roles.cache.has(roleId) ?? false;
  }

  /** Le membre porte-t-il AU MOINS UN de ces rôles ? */
  hasAnyRole(member: GuildMember | null | undefined, roleIds: readonly string[]): boolean {
    return member ? member.roles.cache.hasAny(...roleIds) : false;
  }
}

/** Instance singleton (la policy est sans état). */
export const memberPermissionPolicy = new MemberPermissionPolicy();
