import type { GuildBasedChannel, GuildMember } from 'discord.js';
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

  /** Le membre est-il le propriétaire du serveur ? (il a tous les droits, sans porter le bit Administrator) */
  isOwner(member: GuildMember | null | undefined): boolean {
    return member !== null && member !== undefined && member.id === member.guild.ownerId;
  }

  /**
   * Le membre dispose-t-il de la permission DANS CE SALON ? Les overwrites du
   * salon sont pris en compte ; le propriétaire du serveur voit et fait tout.
   */
  hasIn(member: GuildMember | null | undefined, channel: GuildBasedChannel | null | undefined, permission: PermissionName): boolean {
    if (!member || !channel) return false;
    if (this.isOwner(member) || this.isAdmin(member)) return true;
    return channel.permissionsFor(member)?.has(permissionFlag(permission)) ?? false;
  }

  /**
   * Le membre peut-il agir sur cette cible (modération, rôles) ? Le
   * propriétaire peut sur tous, sauf sur lui-même pour une sanction. Un
   * membre ne le peut que sur une cible dont le rôle le plus haut est
   * strictement sous le sien, jamais sur lui-même sauf `allowSelf`, jamais sur
   * le propriétaire. Une cible absente du serveur n'est permise que si
   * `allowAbsent` (retirer un ban d'un membre parti).
   */
  canActOn(
    actor: GuildMember,
    target: GuildMember | null,
    options: { allowSelf?: boolean; allowAbsent?: boolean } = {},
  ): boolean {
    if (!target) return options.allowAbsent === true;
    const self = target.id === actor.id;
    if (this.isOwner(actor)) return self ? options.allowSelf === true : true;
    if (self) return options.allowSelf === true;
    if (target.id === actor.guild.ownerId) return false;
    return actor.roles.highest.position > target.roles.highest.position;
  }

  /**
   * Le membre peut-il modifier, donner ou retirer ce rôle ? Jamais un rôle
   * géré par une intégration ni @everyone ; le propriétaire peut tous ; un
   * membre seulement un rôle strictement sous son rôle le plus haut.
   */
  canManageRole(actor: GuildMember, role: { id: string; position: number; managed: boolean } | null | undefined): boolean {
    if (!role || role.managed || role.id === actor.guild.id) return false;
    if (this.isOwner(actor)) return true;
    return role.position < actor.roles.highest.position;
  }

  /** Le membre peut-il accorder ces permissions (par leur nom) ? On ne donne que ce que l'on détient. */
  grantsOnly(actor: GuildMember, permissionNames: readonly string[]): boolean {
    if (this.isOwner(actor) || this.isAdmin(actor)) return true;
    const granted: ReadonlySet<string> = new Set(actor.permissions.toArray());
    return permissionNames.every((permission) => granted.has(permission));
  }
}

/** Instance singleton (la policy est sans état). */
export const memberPermissionPolicy = new MemberPermissionPolicy();
