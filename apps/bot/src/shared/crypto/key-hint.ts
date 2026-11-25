/**
 * Indice d'une clé : de quoi la reconnaître sur une carte sans jamais la
 * lire. Les vues des fournisseurs et des intégrations l'utilisent ; une clé
 * déchiffrée ne sort jamais d'un service, seulement son indice.
 */

/** Les points de l'indice ; seuls les quatre derniers caractères de la clé les suivent. */
export const KEY_HINT_MASK = '\u2022\u2022\u2022\u2022';

/** En dessous, les quatre derniers caractères d'une clé sont la clé entière, ou presque : l'indice ne montre rien d'elle. */
export const KEY_HINT_MIN_LENGTH = 2 * KEY_HINT_MASK.length;

export function keyHintOf(apiKey: string | null | undefined): string | null {
  if (!apiKey) return null;
  return apiKey.length >= KEY_HINT_MIN_LENGTH ? `${KEY_HINT_MASK}${apiKey.slice(-4)}` : KEY_HINT_MASK;
}
