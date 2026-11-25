import { WebhookAuthTypeSchema, WebhookMethodSchema, type WebhookAuthType, type WebhookMethod } from '@10cordes/shared';
import type { WebhookEndpoint as WebhookEndpointRow } from '../../../generated/prisma/client';
import { decryptSecret, encryptSecret, isEncrypted } from '../../shared/crypto/secret-box';
import type { ProviderSecrets } from '../providers/provider-store.codec';
import { WebhookEndpointError } from './webhook-endpoint.errors';

/**
 * Lecture d'un connecteur HTTP sortant : aller-retour entre une ligne
 * `webhook_endpoints` et ce qu'en consomment l'appel et les vues. Fonctions
 * pures ; le déchiffrement n'a lieu qu'ici.
 *
 * Les en-têtes secrets sont UN objet JSON chiffré (colonne `encryptedHeaders`),
 * les en-têtes publics un objet JSON en clair (`publicHeadersJson`). Une
 * colonne illisible (indéchiffrable, mal formée) se lit comme un
 * enregistrement VIDE : la lecture ne lève jamais, l'appel part sans cet
 * en-tête et le refus du service distant se voit dans le statut.
 */

/** Nom d'en-tête HTTP : un jeton RFC 7230, de 1 à 60 caractères. */
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,60}$/u;
/** Valeur d'en-tête : les caractères d'un champ HTTP, ni saut de ligne ni caractère de contrôle (hors tabulation). */
const HEADER_VALUE_RE = /^[\t\x20-\x7e\x80-\xff]*$/u;
/** Longueur gardée pour la valeur d'un en-tête, comme au contrat. */
const HEADER_VALUE_MAX = 1000;

/** Une ligne `webhook_endpoints`, telle que Prisma la rend. */
export type { WebhookEndpointRow };

/**
 * Un connecteur prêt à l'emploi. `secretHeaders` est DÉCHIFFRÉ : en mémoire
 * seulement. Il ne va jamais dans une vue, un résultat de tool, un audit ou
 * un journal ; une vue reçoit un `WebhookEndpointSummary`.
 */
export interface WebhookEndpoint {
  id: string;
  guildId: string;
  slug: string;
  name: string;
  method: WebhookMethod;
  url: string;
  authType: WebhookAuthType;
  /** En-tête qui porte l'identifiant (défauts : `Authorization` pour bearer, `X-Api-Key` pour header). */
  authHeaderName: string | null;
  secretHeaders: Record<string, string>;
  publicHeaders: Record<string, string>;
  /** Gabarit du corps (valeur JSON), ou null pour aucun corps. */
  requestTemplate: unknown;
  responseExtractPath: string | null;
  enabled: boolean;
  lastHttpStatus: number | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Ce qu'il reste d'un connecteur quand les en-têtes secrets sont remplacés par leurs noms : la seule forme qu'une vue reçoit. */
export type WebhookEndpointSummary = Omit<WebhookEndpoint, 'secretHeaders'> & { secretHeaderNames: string[] };

/** Connecteur d'une ligne. */
export function webhookFromRow(row: WebhookEndpointRow, secrets: ProviderSecrets): WebhookEndpoint {
  return {
    id: row.id,
    guildId: row.guildId,
    slug: row.slug,
    name: row.name,
    method: methodOf(row.method),
    url: row.url,
    authType: authTypeOf(row.authType),
    authHeaderName: row.authHeaderName,
    secretHeaders: decodeSecretHeaders(row.encryptedHeaders, secrets),
    publicHeaders: parseHeaderRecord(row.publicHeadersJson) ?? {},
    requestTemplate: parseJson(row.requestTemplateJson),
    responseExtractPath: row.responseExtractPath,
    enabled: row.enabled,
    lastHttpStatus: row.lastHttpStatus,
    lastCheckedAt: row.lastCheckedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Connecteur sans ses secrets : les VALEURS des en-têtes secrets ne sortent pas, seulement leurs noms, triés. */
export function summaryOf(endpoint: WebhookEndpoint): WebhookEndpointSummary {
  const { secretHeaders, ...rest } = endpoint;
  return { ...rest, secretHeaderNames: Object.keys(secretHeaders).sort() };
}

/** En-têtes secrets d'une ligne, déchiffrés. Une colonne absente, indéchiffrable ou mal formée rend un enregistrement vide. */
export function decodeSecretHeaders(ciphertext: string | null | undefined, secrets: ProviderSecrets): Record<string, string> {
  // Seule une valeur chiffrée est relue : du texte en clair dans cette colonne est une anomalie, pas un secret à utiliser.
  if (!ciphertext || !isEncrypted(ciphertext)) return {};
  const plaintext = decryptSecret(ciphertext, secrets);
  if (plaintext === null) return {};
  return parseHeaderRecord(plaintext) ?? {};
}

/** En-têtes secrets avant écriture : UN objet JSON chiffré, ou null quand il n'y en a aucun. */
export function encodeSecretHeaders(headers: Readonly<Record<string, string>>, secrets: ProviderSecrets): string | null {
  return Object.keys(headers).length > 0 ? encryptSecret(JSON.stringify(headers), secrets) : null;
}

/** En-têtes publics avant écriture : un objet JSON, ou null quand il n'y en a aucun. */
export function publicHeadersJsonOf(headers: Readonly<Record<string, string>>): string | null {
  return Object.keys(headers).length > 0 ? JSON.stringify(headers) : null;
}

/** En-têtes contrôlés et nettoyés (nom sans espaces) ; le premier problème est refusé, jamais corrigé en silence. */
export function assertHeaderRecord(headers: Readonly<Record<string, string>>, label: string): Record<string, string> {
  const issue = headerRecordIssue(headers);
  if (issue) throw new WebhookEndpointError(`${label} : ${issue}`, 'invalid');
  return Object.fromEntries(Object.entries(headers).map(([header, value]) => [header.trim(), value]));
}

/** Ce nom est-il un nom d'en-tête HTTP envoyable (jeton RFC 7230, 1 à 60 caractères) ? */
export function isHeaderName(name: string): boolean {
  return HEADER_NAME_RE.test(name);
}

/** Premier problème d'un enregistrement d'en-têtes, ou null si tout est envoyable. Le message nomme l'en-tête, jamais sa valeur. */
export function headerRecordIssue(headers: Readonly<Record<string, string>>): string | null {
  for (const [rawName, value] of Object.entries(headers)) {
    const header = rawName.trim();
    if (!isHeaderName(header)) return `nom d\u0027en-tête invalide « ${rawName.slice(0, 60)} ».`;
    if (value.length > HEADER_VALUE_MAX) return `en-tête « ${header} » : valeur trop longue (${HEADER_VALUE_MAX} caractères au plus).`;
    if (!HEADER_VALUE_RE.test(value)) return `en-tête « ${header} » : valeur refusée (saut de ligne ou caractère de contrôle).`;
  }
  return null;
}

/** Un enregistrement d'en-têtes lu d'une colonne JSON : un objet de chaînes, sinon null. */
export function parseHeaderRecord(json: string | null | undefined): Record<string, string> | null {
  const parsed = parseJson(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed);
  return entries.every(([, value]) => typeof value === 'string') ? Object.fromEntries(entries as Array<[string, string]>) : null;
}

/** Une valeur JSON lue d'une colonne ; absente ou mal formée, elle rend null. */
export function parseJson(json: string | null | undefined): unknown {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    return value;
  } catch {
    return null;
  }
}

/** Méthode d'une ligne ; une valeur inconnue retombe sur POST, celle d'un connecteur. */
export function methodOf(value: string): WebhookMethod {
  const parsed = WebhookMethodSchema.safeParse(value);
  return parsed.success ? parsed.data : 'POST';
}

/** Type d'authentification d'une ligne ; une valeur inconnue retombe sur aucun. */
export function authTypeOf(value: string): WebhookAuthType {
  const parsed = WebhookAuthTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'none';
}
