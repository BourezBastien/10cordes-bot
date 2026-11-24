import { providerHttpError } from '../provider-http';
import { ProviderError, type ProviderConfig } from '../provider.types';

/**
 * Erreurs des adaptateurs HTTP, une seule sortie : sans la clé. Certaines API
 * recopient la clé dans leur corps d'erreur (401 d'OpenAI) ou dans une
 * réponse réussie (endpoint qui renvoie la requête). Le texte est masqué
 * AVANT la troncature de `providerHttpError` : une coupe au milieu du secret
 * laisserait un morceau de clé.
 *
 * Communs à tous les adaptateurs HTTP. Leur place naturelle est le socle
 * (`providerHttpError`), qui ne masque rien aujourd'hui.
 */

const MASK = '[clé masquée]';

/** En dessous, une « clé » n'est pas un secret réaliste : la remplacer partout détruirait les données (base64 d'une image). */
const MIN_SECRET_LENGTH = 8;

function maskable(secret: string | null): secret is string {
  return secret !== null && secret.length >= MIN_SECRET_LENGTH;
}

/** Le texte, chaque occurrence de la clé remplacée par un masque. */
export function redactSecret(text: string, secret: string | null): string {
  return maskable(secret) && text.includes(secret) ? text.replaceAll(secret, MASK) : text;
}

/** Valeur de résultat parcourue : chaque chaîne, clé comme valeur, est masquée. La source n'est pas modifiée. */
export function redactDeep<T>(value: T, secret: string | null): T {
  if (!maskable(secret)) return value;
  if (typeof value === 'string') return redactSecret(value, secret) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, secret)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactSecret(key, secret), redactDeep(item, secret)])) as T;
  }
  return value;
}

/** La même erreur, son message masqué s'il contenait la clé. Toute autre valeur est rendue telle quelle. */
export function redactError(error: unknown, secret: string | null): unknown {
  if (!(error instanceof ProviderError) || !maskable(secret) || !error.message.includes(secret)) return error;
  return new ProviderError(redactSecret(error.message, secret), error.kind, error.status);
}

/** Erreur typée d'une réponse : statut + extrait du corps, sans la clé. */
export async function responseError(response: Response, config: ProviderConfig): Promise<ProviderError> {
  return providerHttpError(response.status, redactSecret(await response.text().catch(() => ''), config.apiKey));
}

/** Réponse non 2xx : lève l'erreur typée. */
export async function assertProviderOk(response: Response, config: ProviderConfig): Promise<void> {
  if (response.ok) return;
  throw await responseError(response, config);
}

/** Message d'un échec pour un résumé : l'erreur typée (masquée), sinon le seul nom de l'erreur inattendue. */
export function failureSummary(error: unknown, secret: string | null): string {
  if (error instanceof ProviderError) return redactSecret(error.message, secret);
  return `Erreur inattendue (${error instanceof Error ? error.name : 'sans type'}).`;
}
