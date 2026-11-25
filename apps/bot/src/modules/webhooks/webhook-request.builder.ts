import type { WebhookAuthType, WebhookMethod } from '@10cordes/shared';
import { assertProviderUrl } from '../providers/provider-http';
import { headerRecordIssue, type WebhookEndpoint } from './webhook-endpoint.codec';

/**
 * Requête d'un connecteur HTTP sortant : fonction pure. Un connecteur et une
 * charge utile entrent, la requête exacte qui part (URL, méthode, en-têtes,
 * corps) sort, ou un refus lisible. Rien n'est envoyé ici.
 *
 * Convention d'authentification, simple et explicite : l'identifiant est un
 * EN-TÊTE SECRET, rangé sous le nom donné par `authHeaderName` (défaut
 * `Authorization` pour `bearer`, `X-Api-Key` pour `header`).
 * - `none` : rien d'ajouté ;
 * - `bearer` : la valeur part en `Bearer <valeur>`, sauf si elle commence déjà par `Bearer ` ;
 * - `header` : la valeur part telle quelle.
 * Un type déclaré sans son en-tête secret est refusé : un connecteur
 * authentifié n'est jamais appelé sans son identifiant.
 *
 * Les en-têtes publics partent en clair, puis les secrets (la casse des noms
 * ne compte pas, un secret l'emporte). Corps : le gabarit où `{{payload}}`
 * reçoit la charge utile et `{{payload.a.b}}` la valeur de ce chemin (le type
 * est conservé quand le marqueur occupe toute la chaîne). GET, DELETE et un
 * connecteur sans gabarit n'envoient aucun corps ; avec un corps et aucun
 * Content-Type donné, `application/json` est posé.
 */

/** Délai de tout l'échange d'un connecteur, redirections et lecture comprises. */
export const WEBHOOK_TIMEOUT_MS = 15_000;
/** Taille gardée de la réponse d'un connecteur. */
export const WEBHOOK_BODY_MAX_BYTES = 256 * 1024;
/** Taille gardée de la valeur extraite d'une réponse : c'est ce qui part au modèle. */
export const EXTRACTED_MAX_CHARS = 8_000;
const EXTRACTED_PREVIEW_CHARS = 2_000;
/** Charge utile acceptée, en caractères JSON. */
const PAYLOAD_MAX_CHARS = 16_000;
/** Corps sérialisé accepté (le gabarit peut répéter la charge utile). */
const REQUEST_BODY_MAX_CHARS = 64_000;

/** En-tête par défaut de l'identifiant, par type d'authentification. */
const DEFAULT_AUTH_HEADERS: Record<Exclude<WebhookAuthType, 'none'>, string> = {
  bearer: 'Authorization',
  header: 'X-Api-Key',
};

/** La requête qui part, prête pour la garde des requêtes sortantes. Les en-têtes secrets y sont en clair : en mémoire seulement. */
export interface WebhookRequestPlan {
  url: string;
  method: WebhookMethod;
  headers: Record<string, string>;
  /** Corps JSON sérialisé, ou null. */
  body: string | null;
  /** Chemin à lire dans la réponse, ou null pour ne pas la lire. */
  extractPath: string | null;
}

export type WebhookRequestBuild = { ok: true; request: WebhookRequestPlan } | { ok: false; summary: string };

/** En-têtes par nom insensible à la casse : un nom n'apparaît qu'une fois, le dernier posé l'emporte. */
class HeaderSet {
  private readonly entries = new Map<string, { name: string; value: string }>();

  set(name: string, value: string): void {
    this.entries.set(name.toLowerCase(), { name, value });
  }

  has(name: string): boolean {
    return this.entries.has(name.toLowerCase());
  }

  toRecord(): Record<string, string> {
    return Object.fromEntries([...this.entries.values()].map((entry) => [entry.name, entry.value]));
  }
}

type Refusal = { summary: string };

/** En-têtes du connecteur : publics, puis secrets, puis l'identifiant déclaré. */
function headersOf(endpoint: WebhookEndpoint): { headers: HeaderSet } | Refusal {
  const issue = headerRecordIssue({ ...endpoint.publicHeaders, ...endpoint.secretHeaders });
  if (issue) return { summary: `En-têtes du connecteur : ${issue}` };
  const credential = credentialOf(endpoint);
  if ('summary' in credential) return credential;
  const headers = new HeaderSet();
  for (const [name, value] of Object.entries(endpoint.publicHeaders)) headers.set(name, value);
  for (const [name, value] of Object.entries(endpoint.secretHeaders)) headers.set(name, value);
  if (credential.credential) headers.set(credential.credential.name, credential.credential.value);
  return { headers };
}

/** L'identifiant déclaré par `authType`, lu dans les en-têtes secrets (la casse du nom près) ; null sans authentification. */
function credentialOf(endpoint: WebhookEndpoint): { credential: { name: string; value: string } | null } | Refusal {
  if (endpoint.authType === 'none') return { credential: null };
  const name = endpoint.authHeaderName ?? DEFAULT_AUTH_HEADERS[endpoint.authType];
  const wanted = name.toLowerCase();
  const stored = Object.entries(endpoint.secretHeaders).find(([header]) => header.toLowerCase() === wanted)?.[1]?.trim();
  if (!stored) {
    return { summary: `authentification « ${endpoint.authType} » déclarée, mais l\u0027en-tête secret « ${name} » manque.` };
  }
  const value = endpoint.authType === 'bearer' && !/^bearer /iu.test(stored) ? `Bearer ${stored}` : stored;
  return { credential: { name, value } };
}

/** Corps sérialisé du gabarit rendu ; null quand la requête n'en porte pas. */
function bodyOf(endpoint: WebhookEndpoint, payload: Record<string, unknown>): { body: string | null } | Refusal {
  if (endpoint.method === 'GET' || endpoint.method === 'DELETE' || endpoint.requestTemplate === null) return { body: null };
  const sizeIssue = payloadIssue(payload);
  if (sizeIssue) return { summary: sizeIssue };
  let body: string | undefined;
  try {
    body = JSON.stringify(renderRequestTemplate(endpoint.requestTemplate, payload));
  } catch {
    body = undefined;
  }
  if (body === undefined) return { summary: 'Le gabarit du corps ne produit pas du JSON.' };
  if (body.length > REQUEST_BODY_MAX_CHARS) {
    return { summary: `Corps de la requête trop lourd (${REQUEST_BODY_MAX_CHARS} caractères au plus) : réduis la charge utile.` };
  }
  return { body };
}

function payloadIssue(payload: Record<string, unknown>): string | null {
  try {
    return JSON.stringify(payload).length > PAYLOAD_MAX_CHARS ? `Charge utile trop lourde (${PAYLOAD_MAX_CHARS} caractères JSON au plus).` : null;
  } catch {
    return 'Charge utile non sérialisable en JSON.';
  }
}

/** Construit la requête, ou refuse avec la raison (URL, en-têtes, charge utile). */
export function buildWebhookRequest(endpoint: WebhookEndpoint, payload: Record<string, unknown>): WebhookRequestBuild {
  const target = urlOf(endpoint.url);
  if ('summary' in target) return { ok: false, summary: target.summary };
  const headers = headersOf(endpoint);
  if ('summary' in headers) return { ok: false, summary: headers.summary };
  const body = bodyOf(endpoint, payload);
  if ('summary' in body) return { ok: false, summary: body.summary };
  if (body.body !== null && !headers.headers.has('Content-Type')) headers.headers.set('Content-Type', 'application/json');
  return {
    ok: true,
    request: { url: target.url, method: endpoint.method, headers: headers.headers.toRecord(), body: body.body, extractPath: endpoint.responseExtractPath },
  };
}

/**
 * URL de l'appel, validée une seconde fois : lue telle quelle (https exigé),
 * puis par la garde des requêtes sortantes (hôte public sur sa forme). Lue
 * par la garde seule, une adresse écrite hors du service comme « https:// »
 * seule se verrait doter d'un schéma au lieu d'être refusée.
 */
function urlOf(raw: string): { url: string } | Refusal {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { summary: 'URL du connecteur refusée : adresse illisible.' };
  }
  if (parsed.protocol !== 'https:') return { summary: 'URL du connecteur refusée : une adresse https est exigée.' };
  try {
    return { url: assertProviderUrl(trimmed) };
  } catch (error) {
    return { summary: `URL du connecteur refusée : ${error instanceof Error ? error.message : 'adresse invalide.'}` };
  }
}

/** Marqueur du gabarit : `{{payload}}`, ou un chemin de la charge utile comme `{{payload.a.b}}`. */
const PLACEHOLDER_RE = /\{\{payload(?:\.[A-Za-z0-9_-]+)*\}\}/gu;

/**
 * Valeur d'un chemin pointé (« a.b.0 ») dans une valeur JSON : la valeur
 * elle-même pour un chemin vide, `undefined` si le chemin n'existe pas. Les
 * objets ne se parcourent que par leurs propres propriétés : `constructor` ou
 * `__proto__` ne mènent nulle part.
 */
export function valueAtPath(source: unknown, path: string): unknown {
  if (path === '') return source;
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function pathOf(marker: string): string {
  const path = marker.slice(2, -2).slice('payload'.length);
  return path.startsWith('.') ? path.slice(1) : path;
}

/** Gabarit rendu : chaque marqueur reçoit la valeur de son chemin dans la charge utile. */
export function renderRequestTemplate(template: unknown, payload: Record<string, unknown>): unknown {
  if (typeof template === 'string') return renderString(template, payload);
  if (Array.isArray(template)) return template.map((item) => renderRequestTemplate(item, payload));
  if (template !== null && typeof template === 'object') {
    return Object.fromEntries(Object.entries(template).map(([key, value]) => [key, renderRequestTemplate(value, payload)]));
  }
  return template;
}

function renderString(text: string, payload: Record<string, unknown>): unknown {
  const markers = [...text.matchAll(PLACEHOLDER_RE)];
  // Seul dans la chaîne : la valeur la remplace, type conservé (un objet reste un objet) ; chemin absent : null.
  if (markers.length === 1 && markers[0][0] === text) {
    const value = valueAtPath(payload, pathOf(markers[0][0]));
    return value === undefined ? null : value;
  }
  // Au milieu d'un texte : forme texte (une chaîne telle quelle, toute autre valeur en JSON) ; chemin absent : rien.
  return text.replace(PLACEHOLDER_RE, (marker) => {
    const value = valueAtPath(payload, pathOf(marker));
    return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  });
}

export interface ExtractedValue {
  /** Valeur du chemin, `null` s'il manque ou si la réponse n'est pas du JSON ; un objet `{ truncated, chars, preview }` si elle dépasse la taille garde. */
  value: unknown;
  truncated: boolean;
}

/** Ce que le chemin d'extraction sélectionne dans une réponse JSON ; rien (null) sans chemin, sans JSON ou sans valeur à ce chemin. */
export function extractResponseValue(body: string, path: string | null): ExtractedValue {
  if (path === null) return { value: null, truncated: false };
  let parsed: unknown;
  try {
    const json: unknown = JSON.parse(body);
    parsed = json;
  } catch {
    return { value: null, truncated: false };
  }
  const value = valueAtPath(parsed, path);
  if (value === undefined) return { value: null, truncated: false };
  const json = JSON.stringify(value);
  if (json !== undefined && json.length > EXTRACTED_MAX_CHARS) {
    return { value: { truncated: true, chars: json.length, preview: json.slice(0, EXTRACTED_PREVIEW_CHARS) }, truncated: true };
  }
  return { value, truncated: false };
}
