/**
 * Motif d'un refus d'un connecteur HTTP sortant. Le contrôleur HTTP le
 * traduit en statut : `conflict` en 409, les deux autres en 422. Une ressource
 * inconnue n'est pas une erreur typée : le service rend null et le contrôleur
 * répond 404.
 */
export type WebhookEndpointErrorKind =
  /** Requête bien formée mais inacceptable : URL refusée, en-tête invalide, gabarit trop lourd. */
  | 'invalid'
  /** Le slug est déjà pris sur ce serveur. */
  | 'conflict'
  /** Quota de connecteurs du serveur atteint. */
  | 'limit';

/**
 * Erreur typée d'un connecteur. Le message est montré tel quel au membre du
 * staff (422 ou 409) : il nomme un champ ou un en-tête, jamais la valeur d'un
 * secret.
 */
export class WebhookEndpointError extends Error {
  constructor(
    message: string,
    public readonly kind: WebhookEndpointErrorKind,
  ) {
    super(message);
    this.name = 'WebhookEndpointError';
  }
}
