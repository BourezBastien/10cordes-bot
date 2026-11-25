import type { WebhookAuthType, WebhookCreate, WebhookMethod, WebhookUpdate } from '@10cordes/shared';
import { assertProviderUrl } from '../providers/provider-http';
import type { ProviderSecrets } from '../providers/provider-store.codec';
import {
  assertHeaderRecord,
  encodeSecretHeaders,
  isHeaderName,
  publicHeadersJsonOf,
  type WebhookEndpoint,
} from './webhook-endpoint.codec';
import { WebhookEndpointError } from './webhook-endpoint.errors';

/**
 * Écriture d'un connecteur HTTP sortant : le contrat de l'API (corps de
 * création et de mise à jour) devient les champs d'une ligne. Fonctions pures,
 * qui refusent tôt et avec un message actionnable (`WebhookEndpointError`,
 * soit un 422) : URL, en-têtes, gabarit du corps. Les identifiants vont dans
 * les en-têtes secrets, chiffrés ici et jamais relus.
 */

/** Taille gardée pour le gabarit du corps, en caractères JSON. */
export const REQUEST_TEMPLATE_MAX_CHARS = 20_000;

/** Champs d'une ligne qu'une création règle : tout sauf identifiant, serveur, slug, dernier statut et dates. */
export interface WebhookEndpointFields {
  name: string;
  method: WebhookMethod;
  url: string;
  authType: WebhookAuthType;
  authHeaderName: string | null;
  encryptedHeaders: string | null;
  publicHeadersJson: string | null;
  requestTemplateJson: string | null;
  responseExtractPath: string | null;
  enabled: boolean;
}

/** Champs qu'une mise à jour change ; absent, un champ ne bouge pas. */
export type WebhookEndpointChanges = Partial<WebhookEndpointFields>;

/**
 * URL d'un connecteur, validée à l'écriture par la garde des requêtes sortantes
 * (https, hôte public sur sa forme : ni localhost, ni adresse privée ou
 * réservée). L'adresse résolue est contrôlée une seconde fois à l'appel. Un
 * identifiant dans l'adresse est refusé : l'URL est montrée en clair.
 */
export function assertWebhookUrl(raw: string): string {
  const trimmed = raw.trim();
  // Lue d'abord telle quelle : la garde complète un schéma manquant et retire les barres finales, ce qui rendrait lisible « https:// » seul.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new WebhookEndpointError('URL refusée : adresse illisible.', 'invalid');
  }
  if (parsed.protocol !== 'https:') throw new WebhookEndpointError('URL refusée : une adresse https est exigée.', 'invalid');
  if (parsed.username || parsed.password) {
    throw new WebhookEndpointError('URL refusée : aucun identifiant dans l\u0027adresse (range-le dans un en-tête secret).', 'invalid');
  }
  try {
    return assertProviderUrl(trimmed);
  } catch (error) {
    throw new WebhookEndpointError(`URL refusée : ${describeUrlRefusal(error, parsed.hostname)}`, 'invalid');
  }
}

/** Raison de la garde, en clair pour le staff ; son message sinon (il ne porte que l'adresse). */
function describeUrlRefusal(error: unknown, hostname: string): string {
  const reason = error instanceof Error ? error.message : '';
  if (reason.startsWith('Blocked host') || reason.startsWith('Blocked address')) {
    return `hôte non public (« ${hostname} » : ni localhost, ni adresse locale, privée ou réservée).`;
  }
  return reason || 'adresse invalide.';
}

/** Champs d'un nouveau connecteur. Les valeurs absentes prennent le défaut du contrat. */
export function newEndpointFields(input: WebhookCreate, secrets: ProviderSecrets): WebhookEndpointFields {
  const authType = input.authType ?? 'none';
  return {
    name: input.name.trim(),
    method: input.method,
    url: assertWebhookUrl(input.url),
    authType,
    authHeaderName: authHeaderNameOf(authType, input.authHeaderName),
    encryptedHeaders: encodeSecretHeaders(assertHeaderRecord(input.secretHeaders ?? {}, 'En-têtes secrets'), secrets),
    publicHeadersJson: publicHeadersJsonOf(assertHeaderRecord(input.publicHeaders ?? {}, 'En-têtes publics')),
    requestTemplateJson: requestTemplateJsonOf(input.requestTemplate ?? null),
    responseExtractPath: extractPathOf(input.responseExtractPath),
    enabled: input.enabled ?? true,
  };
}

/**
 * Changements demandés par une mise à jour. Un champ absent du corps ne bouge
 * pas. En-têtes secrets : absents, la colonne chiffrée n'est pas réécrite ;
 * `null` (ou un objet vide) les retire ; un objet les remplace tous.
 */
export function endpointChanges(
  input: WebhookUpdate,
  existing: Pick<WebhookEndpoint, 'authType' | 'authHeaderName'>,
  secrets: ProviderSecrets,
): WebhookEndpointChanges {
  const changes: WebhookEndpointChanges = {};
  if (input.name !== undefined) changes.name = input.name.trim();
  if (input.url !== undefined) changes.url = assertWebhookUrl(input.url);
  if (input.publicHeaders !== undefined) {
    changes.publicHeadersJson = publicHeadersJsonOf(assertHeaderRecord(input.publicHeaders ?? {}, 'En-têtes publics'));
  }
  if (input.secretHeaders !== undefined) {
    changes.encryptedHeaders = encodeSecretHeaders(assertHeaderRecord(input.secretHeaders ?? {}, 'En-têtes secrets'), secrets);
  }
  if (input.requestTemplate !== undefined) changes.requestTemplateJson = requestTemplateJsonOf(input.requestTemplate);
  if (input.responseExtractPath !== undefined) changes.responseExtractPath = extractPathOf(input.responseExtractPath);
  if (input.enabled !== undefined) changes.enabled = input.enabled;
  if (input.authType !== undefined || input.authHeaderName !== undefined) {
    // Sans authentification, aucun en-tête ne porte l'identifiant ; sinon le nom actuel est gardé tant qu'il n'est pas redonné.
    const authType = input.authType ?? existing.authType;
    changes.authType = authType;
    changes.authHeaderName = authHeaderNameOf(authType, input.authHeaderName ?? (authType === 'none' ? null : existing.authHeaderName));
  }
  return changes;
}

/**
 * En-tête qui porte l'identifiant, tel qu'il est rangé. Vide ou absent : le
 * défaut du type d'authentification s'applique à l'appel (`Authorization` pour
 * bearer, `X-Api-Key` pour header).
 */
export function authHeaderNameOf(authType: WebhookAuthType, raw: string | null | undefined): string | null {
  if (authType === 'none') return null;
  const name = raw?.trim() || null;
  if (name !== null && !isHeaderName(name)) {
    throw new WebhookEndpointError(`Nom d\u0027en-tête d\u0027authentification invalide « ${name} ».`, 'invalid');
  }
  return name;
}

/** Chemin d'extraction de la réponse ; une chaîne vide ne sélectionne rien. */
export function extractPathOf(raw: string | null | undefined): string | null {
  return raw?.trim() || null;
}

/** Gabarit du corps, sérialisé ; null quand il n'y a aucun corps. Refuse ce qui n'est pas du JSON ou ce qui dépasse la taille garde. */
export function requestTemplateJsonOf(template: unknown): string | null {
  if (template === null || template === undefined) return null;
  let json: string | undefined;
  try {
    json = JSON.stringify(template);
  } catch {
    json = undefined;
  }
  if (json === undefined) throw new WebhookEndpointError('Gabarit du corps : donne une valeur JSON.', 'invalid');
  if (json.length > REQUEST_TEMPLATE_MAX_CHARS) {
    throw new WebhookEndpointError(`Gabarit du corps trop lourd (${REQUEST_TEMPLATE_MAX_CHARS} caractères JSON au plus).`, 'invalid');
  }
  return json;
}
