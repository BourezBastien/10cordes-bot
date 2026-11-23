/**
 * Erreurs typées du fournisseur IA, et leur traduction depuis une réponse
 * HTTP. Une seule table de décision pour les appels en streaming et bloquants.
 */

/** Crédits du fournisseur IA épuisés : l'appel est refusé côté API (402). */
export class QuotaExhaustedError extends Error {
  constructor() {
    super('Crédits IA épuisés : le fournisseur a refusé l\u0027appel (402).');
    this.name = 'QuotaExhaustedError';
  }
}

/** Clé/API invalide ou révoquée : configuration à corriger (401/403). */
export class ProviderAuthError extends Error {
  constructor() {
    super('Configuration IA invalide : le fournisseur rejette l\u0027authentification (401).');
    this.name = 'ProviderAuthError';
  }
}

/** Fournisseur indisponible ou erreur serveur (5xx, réseau). */
export class ProviderUnavailableError extends Error {
  constructor() {
    super('Fournisseur IA indisponible (erreur serveur ou réseau).');
    this.name = 'ProviderUnavailableError';
  }
}

/** Réponse HTTP d'échec non reconnue : le statut et le détail restent disponibles (compatibilité d'endpoint). */
export class ProviderHttpError extends Error {
  readonly detail: string;

  constructor(
    public readonly status: number,
    detail: string,
  ) {
    super(`LLM ${status}: ${detail.slice(0, 200)}`);
    this.name = 'ProviderHttpError';
    this.detail = detail.slice(0, 1000);
  }
}

/**
 * Le modèle a écrit ses JETONS INTERNES d'appel d'outil dans le texte
 * (`<｜DSML｜function_calls>`, `<tool_call>`...) au lieu d'un tool_call
 * structuré. Le tour est refusé : ce texte ne doit jamais atteindre Discord.
 */
export class LlmFormatLeakError extends Error {
  constructor(public readonly sample: string) {
    super('Le fournisseur IA a mélangé ses balises internes d\u0027appel d\u0027outil au texte.');
    this.name = 'LlmFormatLeakError';
  }
}

/** Notice salon quand les crédits sont épuisés : la même pour la boucle et la livraison. */
export const QUOTA_EXHAUSTED_MESSAGE = 'IA désactivée : crédits DeepSeek épuisés. Recharge le compte API, je reprends dès que c\u0027est réglé.';

/**
 * Convertit une réponse HTTP en erreur du fournisseur. À appeler uniquement
 * sur un statut d'échec (le détail est tronqué : jamais de clé dans un log).
 */
export function throwProviderError(status: number, detail: string): never {
  if (status === 402 || detail.includes('insufficient_balance')) {
    throw new QuotaExhaustedError();
  }
  if (status === 401 || status === 403) {
    throw new ProviderAuthError();
  }
  if (status >= 500) {
    throw new ProviderUnavailableError();
  }
  throw new ProviderHttpError(status, detail);
}
