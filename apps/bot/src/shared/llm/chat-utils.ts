/**
 * Helpers purs du client LLM, partagés par le client et les adaptateurs de
 * fournisseurs : noms de tools (l'API refuse les points), URL de base,
 * nettoyage des textes et masquage de clé.
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

/** Nom d'hôte d'une URL de base ou d'un hôte nu (sans port) ; vide si illisible. */
export function hostOf(baseUrlOrHost: string): string {
  const raw = baseUrlOrHost.trim().toLowerCase().replace(/:\d+$/u, '');
  if (!raw.includes('://')) return raw;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** L'hôte est-il exactement ce domaine ou un de ses sous-domaines ? (`domaine.fr.autre.example` ne l'est pas) */
function isHostOf(baseUrlOrHost: string, domain: string): boolean {
  return hostOf(baseUrlOrHost) === domain || hostOf(baseUrlOrHost).endsWith(`.${domain}`);
}

/** DeepSeek : `deepseek.com` ou un sous-domaine. Seuls ses endpoints ont un comportement vérifié ici. */
export function isDeepSeekHost(baseUrlOrHost: string): boolean {
  return isHostOf(baseUrlOrHost, 'deepseek.com');
}

/** Anthropic : `anthropic.com` ou un sous-domaine. */
export function isAnthropicHost(baseUrlOrHost: string): boolean {
  return isHostOf(baseUrlOrHost, 'anthropic.com');
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
