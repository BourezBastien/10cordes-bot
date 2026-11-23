import { PermissionFlagsBits } from 'discord.js';

/**
 * Couche Sécurité (A1) — le SEUL endroit du code où les permissions
 * Discord sont vérifiées. Toute autre classe doit passer par une Policy.
 */

/** Contexte d'autorisation minimal pour une guilde Discord. */
export interface GuildAccessContext {
  userId: string;
  guildOwnerId: string;
  permissions: string[];
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
 * Sous-classes : GuildAdminPolicy, (futur) ChannelWritePolicy, etc.
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

/**
 * Politique : propriétaire du serveur OU permission Administrator.
 * La seule Policy utilisée pour les intégrations et les actions admin.
 */
export class GuildAdminPolicy extends BaseAccessPolicy<GuildAccessContext> {
  readonly policyName = 'GuildAdmin';

  isAuthorized(ctx: GuildAccessContext): boolean {
    return (
      ctx.userId === ctx.guildOwnerId ||
      ctx.permissions.includes('Administrator') ||
      ctx.permissions.includes(PermissionFlagsBits.Administrator.toString())
    );
  }

  protected describeDenial(_ctx: GuildAccessContext): string {
    return 'Seul un administrateur du serveur peut effectuer cette action.';
  }
}

/** Instance singleton (les Policy sont sans état). */
export const guildAdminPolicy = new GuildAdminPolicy();
