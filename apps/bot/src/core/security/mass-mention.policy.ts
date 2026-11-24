import { guildAdminPolicy, type GuildAccessContext } from './access-policy';
import { neutralizeMassMentions } from '../../shared/utils/mass-mentions';

/**
 * Policy « le bot peut-il pinguer tout le serveur pour cet acteur ? »
 *
 * Le bot a souvent le droit de mentionner @everyone là où le demandeur ne
 * l'a pas : sans cette policy, n'importe quel membre ferait pinguer tout le
 * serveur en demandant simplement au bot d'envoyer « @everyone ». Décision
 * produit (18/11) : seuls le propriétaire du serveur et un administrateur
 * le peuvent. Les autres voient la mention s'afficher en texte, sans ping.
 *
 * Sans acteur (exécution du système : déclencheur planifié, tâche, événement),
 * rien ne pingue : on ne sait plus qui a demandé. L'acteur est un contexte
 * d'accès de guilde (`guildAccessContext`, `accessContextFromNames`).
 */

export class MassMentionPolicy {
  readonly policyName = 'MassMention';

  /** L\u0027acteur peut-il faire envoyer une mention de masse (@everyone, @here) par le bot ? */
  allows(actor: GuildAccessContext | null): boolean {
    return actor !== null && guildAdminPolicy.isAuthorized(actor);
  }

  /** Le texte tel que le bot peut l\u0027envoyer pour cet acteur : sans le droit, toute mention de masse est neutralisée. */
  guard(text: string, actor: GuildAccessContext | null): string {
    return this.allows(actor) ? text : neutralizeMassMentions(text);
  }
}

/** Instance singleton (la policy est sans état). */
export const massMentionPolicy = new MassMentionPolicy();
