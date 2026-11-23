/**
 * Helpers purs du client LLM : noms de tools (l'API refuse les points),
 * URL de base, nettoyage des textes et masquage de clé.
 */

/** Les noms de tools namespacés sont encodés pour l'API (points interdits). */
export function toApiToolName(name: string): string {
  return name.replaceAll('.', '__');
}

export function fromApiToolName(apiName: string): string {
  return apiName.replaceAll('__', '.');
}

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Les contenus Discord (messages des membres, transcripts, résultats d'outils)
 * peuvent contenir des surrogate pairs isolés (emoji copiés-collés corrompus).
 * JSON.stringify les encode en \uD83X seuls : le fournisseur répond alors
 * 400 « unexpected end of hex escape » et la demande échoue. On les retire.
 */
export function stripLoneSurrogates(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu, '');
}

/** Clé tronquée pour un statut affichable : jamais plus de 9 caractères utiles. */
export function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}
