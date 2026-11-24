import type { Guild, GuildMember } from 'discord.js';
import { permissionsOf, permissionFlag, type PermissionName } from './permission-name';

/**
 * Couche Sécurité (A1) : les Policies d'accès. Le SEUL endroit du code où les
 * permissions Discord d'un utilisateur sont vérifiées. Toute autre classe
 * passe par une Policy et désigne les permissions par leur nom.
 */

/** Contexte d'autorisation minimal pour une guilde Discord. */
export interface GuildAccessContext {
  userId: string;
  guildOwnerId: string;
  /** Noms des permissions du membre (Administrator, ManageGuild...). */
  permissions: string[];
}

/**
 * Construit le contexte d'accès d'un membre d'un serveur. Le membre peut être
 * absent du cache : les permissions sont alors vides (aucun droit).
 */
export function guildAccessContext(guild: Guild, userId: string, member: GuildMember | null | undefined): GuildAccessContext {
  return { userId, guildOwnerId: guild.ownerId, permissions: permissionsOf(member) };
}

/**
 * Contexte d'accès à partir de noms de permissions DÉJÀ résolus (contexte
 * d'exécution d'un tool, job ou trigger) : le membre Discord n'est plus disponible.
 */
export function accessContextFromNames(guild: Guild, userId: string, permissionNames: readonly string[]): GuildAccessContext {
  return { userId, guildOwnerId: guild.ownerId, permissions: [...permissionNames] };
}

/** Ce qu'une interaction (bouton, modale, select) révèle de son auteur. */
export interface InteractionAccessSource {
  user: { id: string };
  guild: { ownerId: string } | null;
  memberPermissions?: { toArray(): string[] } | null;
}

/** Contexte d'accès dérivé d'une interaction ; null hors serveur. */
export function interactionAccessContext(interaction: InteractionAccessSource): GuildAccessContext | null {
  if (!interaction.guild) return null;
  return {
    userId: interaction.user.id,
    guildOwnerId: interaction.guild.ownerId,
    permissions: interaction.memberPermissions?.toArray() ?? [],
  };
}

/** Erreur domaine typée : accès refusé par une Policy. */
export class ForbiddenDomainError extends Error {
  constructor(
    public readonly policy: string,
    public readonly reason: string,
  ) {
    super(`Accès refusé (${policy}) : ${reason}`);
    this.name = 'ForbiddenDomainError';
  }
}

/**
 * Politique d'accès abstraite (Pattern Strategy).
 * Sous-classes : GuildAdminPolicy, GuildManagerPolicy.
 */
export abstract class BaseAccessPolicy<TContext> {
  abstract readonly policyName: string;

  /** Vérifie silencieusement (booléen). */
  abstract isAuthorized(ctx: TContext): boolean;

  /** Vérifie et lève ForbiddenDomainError si refusé. */
  assertAuthorized(ctx: TContext): void {
    if (!this.isAuthorized(ctx)) {
      throw new ForbiddenDomainError(this.policyName, this.describeDenial(ctx));
    }
  }

  /** Message lisible expliquant le refus (pour l'éphémère Discord). */
  protected abstract describeDenial(ctx: TContext): string;
}

/** Le contexte est-il celui du propriétaire du serveur ? */
function isGuildOwner(ctx: GuildAccessContext): boolean {
  return ctx.userId === ctx.guildOwnerId;
}

/**
 * Contexte d'accès du MEMBRE qui agit (clic sur une surface, action de
 * composant). Null pour le système : pas de membre, ou le bot lui-même
 * (un déclencheur planifié s'exécute « en tant que le bot »).
 */
export function actingMemberContext(member: GuildMember | null | undefined): GuildAccessContext | null {
  return member && !member.user.bot ? guildAccessContext(member.guild, member.id, member) : null;
}

/** Contexte d'accès du demandeur d'un tool, lu dans le serveur de la demande ; null hors serveur. */
export function toolRequesterContext(ctx: { userId: string; permissions: readonly string[] }, guild: Guild | null): GuildAccessContext | null {
  return guild ? accessContextFromNames(guild, ctx.userId, ctx.permissions) : null;
}

/**
 * Le contexte porte-t-il cette permission ? Les permissions arrivent soit
 * par leur nom (Administrator, issue de `permissions.toArray()`), soit par la
 * valeur du bitflag (8). Les deux formes sont acceptées.
 */
function granted(ctx: GuildAccessContext, permission: PermissionName): boolean {
  return ctx.permissions.includes(permission) || ctx.permissions.includes(permissionFlag(permission).toString());
}

/**
 * Politique : propriétaire du serveur OU permission Administrator.
 * Pour les intégrations et les actions d'administration.
 */
export class GuildAdminPolicy extends BaseAccessPolicy<GuildAccessContext> {
  readonly policyName = 'GuildAdmin';

  /** Le membre est-il propriétaire du serveur ? */
  isOwner(ctx: GuildAccessContext): boolean {
    return isGuildOwner(ctx);
  }

  isAuthorized(ctx: GuildAccessContext): boolean {
    return isGuildOwner(ctx) || granted(ctx, 'Administrator');
  }

  protected describeDenial(_ctx: GuildAccessContext): string {
    return 'Seul un administrateur du serveur peut effectuer cette action.';
  }
}

/**
 * Politique : permission ManageGuild (ou Administrator, ou propriétaire).
 * Pour le tableau de bord et tout ce qui règle la configuration du serveur.
 */
export class GuildManagerPolicy extends BaseAccessPolicy<GuildAccessContext> {
  readonly policyName = 'GuildManager';

  isAuthorized(ctx: GuildAccessContext): boolean {
    return isGuildOwner(ctx) || granted(ctx, 'ManageGuild') || granted(ctx, 'Administrator');
  }

  protected describeDenial(_ctx: GuildAccessContext): string {
    return 'La permission Gérer le serveur est requise.';
  }
}

/** Instances singletons (les Policy sont sans état). */
export const guildAdminPolicy = new GuildAdminPolicy();
export const guildManagerPolicy = new GuildManagerPolicy();
