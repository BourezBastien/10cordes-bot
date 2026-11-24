import { assertSafeUrl, safeFetch } from '../../shared/utils/safe-fetch';
import { ProviderError, type ProviderConfig } from './provider.types';

/**
 * Requêtes sortantes d'un fournisseur. Toutes passent par la garde des
 * requêtes sortantes (https uniquement, hôte public) : un fournisseur
 * « local » (localhost, adresse privée) est refusé, c'est voulu (SSRF).
 */

/** Complète le schéma https si l'administrateur l'a omis, sans rien tolérer d'autre. */
export function normalizeProviderUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/u, '');
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** URL de base valide, sinon erreur de fournisseur « invalid ». */
export function assertProviderUrl(baseUrl: string): string {
  try {
    assertSafeUrl(normalizeProviderUrl(baseUrl));
    return normalizeProviderUrl(baseUrl);
  } catch (error) {
    throw new ProviderError(error instanceof Error ? error.message : 'URL de fournisseur invalide.', 'invalid');
  }
}

/** URL d'un appel : base + chemin (+ requête), la clé en paramètre si l'auth le demande. */
export function buildProviderUrl(config: ProviderConfig, path: string, query?: Record<string, string>): URL {
  const base = assertProviderUrl(config.baseUrl);
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  if (config.authType === 'query' && config.apiKey) url.searchParams.set(config.authHeaderName || 'api_key', config.apiKey);
  return url;
}

/** En-têtes de la requête : ceux du fournisseur, puis l'authentification. */
export function providerHeaders(config: ProviderConfig, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...config.customHeaders, ...extra };
  if (config.apiKey) {
    if (config.authType === 'bearer') headers.Authorization = `Bearer ${config.apiKey}`;
    else if (config.authType === 'header') headers[config.authHeaderName || 'X-API-Key'] = config.apiKey;
  }
  return headers;
}

/** Statut HTTP d'échec → erreur typée. Le message est tronqué et ne contient jamais la clé. */
export function providerHttpError(status: number, detail: string): ProviderError {
  const excerpt = detail.replace(/\s+/gu, ' ').trim().slice(0, 160);
  const message = excerpt ? `HTTP ${status} : ${excerpt}` : `HTTP ${status}`;
  if (status === 401 || status === 403) return new ProviderError(message, 'auth', status);
  if (status === 402) return new ProviderError(message, 'quota', status);
  if (status === 429) return new ProviderError(message, 'rate-limit', status);
  if (status >= 500) return new ProviderError(message, 'unavailable', status);
  return new ProviderError(message, status === 408 ? 'timeout' : 'http', status);
}

export type ProviderFetchInit = Omit<RequestInit, 'headers'> & {
  timeoutMs?: number;
  query?: Record<string, string>;
  headers?: Record<string, string>;
};

/**
 * Appel à un fournisseur. Lève `ProviderError` (jamais l'erreur brute du
 * runtime, qui peut contenir l'URL et donc une clé en paramètre).
 */
export async function providerFetch(config: ProviderConfig, path: string, init: ProviderFetchInit = {}): Promise<Response> {
  const { query, timeoutMs, headers, ...rest } = init;
  const isForm = rest.body instanceof FormData;
  try {
    return await safeFetch(buildProviderUrl(config, path, query).toString(), {
      ...rest,
      headers: providerHeaders(config, { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...headers }),
      timeoutMs,
    });
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    // Une annulation demandée par l'appelant n'est pas une panne du fournisseur : jamais de bascule sur le repli.
    if (rest.signal?.aborted) throw new ProviderError('Demande annulée.', 'http');
    const name = error instanceof Error ? error.name : '';
    const timedOut = /timeout/iu.test(name);
    throw new ProviderError(timedOut ? 'Le fournisseur n\u0027a pas répondu à temps.' : 'Requête impossible : réseau ou hôte injoignable.', timedOut ? 'timeout' : 'unavailable');
  }
}

/** Corps JSON, ou null si illisible. */
export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Valeur d'un chemin pointé dans un objet JSON (« data.resultUrls.0 », « image.base64 »). */
export function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), source);
}
