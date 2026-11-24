import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPrivateAddress } from './private-address';

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^\[?::1\]?$/,
  /\.local$/i,
  /\.internal$/i,
];

/**
 * Valide une URL pour tout usage serveur : https uniquement, host jamais
 * localhost / privé / réservé (sur sa forme). Exportée pour les
 * consommateurs non-fetch (ex : passer une URL à ffmpeg dans le module vocal).
 */
export function assertSafeUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`Only https URLs are allowed: ${url}`);
  if (BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) {
    throw new Error(`Blocked host: ${parsed.hostname}`);
  }
  return parsed;
}

/**
 * Refuse un hôte qui désigne une adresse locale, privée ou réservée : par sa
 * forme (littérale), sinon par ce qu'il résout. Un nom public qui pointe sur
 * une adresse interne est la façon la plus courante d'atteindre le réseau du
 * serveur. Un nom qui ne résout pas n'est pas retenu ici : la requête
 * échouera d'elle-même, avec l'erreur de réseau de l'appelant.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/gu, '');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`Blocked address: ${host}`);
    return;
  }
  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(host, { all: true, verbatim: true });
  } catch {
    return;
  }
  if (resolved.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error(`Blocked host: ${hostname} (résout vers une adresse locale, privée ou réservée)`);
  }
}

/** Délai par défaut d'une requête gardée, redirections et lecture du corps comprises. */
export const SAFE_FETCH_TIMEOUT_MS = 30_000;

export type SafeFetchInit = RequestInit & {
  /** Délai de la requête ; `null` quand c'est le signal de l'appelant qui décide seul. */
  timeoutMs?: number | null;
};

/** Statuts de redirection, ceux que le runtime suivrait de lui-même. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 10;
/** En-têtes qui n'ont pas à suivre une redirection vers une autre origine. */
const ORIGIN_SCOPED_HEADERS = ['authorization', 'proxy-authorization', 'cookie', 'host'];
/** En-têtes qui décrivent un corps : sans objet quand la redirection le fait tomber. */
const BODY_HEADERS = ['content-encoding', 'content-language', 'content-location', 'content-type', 'content-length'];

/** Libère la connexion d'une réponse dont le corps ne sera pas lu. */
async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/**
 * Requête du saut suivant, selon les règles du runtime : un 303 (ou un 301
 * ou 302 sur un POST) repart en GET sans corps, un 307 ou 308 rejoue la
 * requête à l'identique. Vers une autre origine, les identifiants ne suivent pas.
 */
function redirectedRequest(request: RequestInit, status: number, from: URL, to: URL): RequestInit {
  const method = (request.method ?? 'GET').toUpperCase();
  const withoutBody = status === 303 ? method !== 'HEAD' : (status === 301 || status === 302) && method === 'POST';
  const sameOrigin = from.origin === to.origin;
  if (sameOrigin && !withoutBody) return request;
  const kept = new Headers(request.headers);
  const replayed: RequestInit = { ...request, headers: kept };
  if (!sameOrigin) for (const name of ORIGIN_SCOPED_HEADERS) kept.delete(name);
  if (!withoutBody) return replayed;
  for (const name of BODY_HEADERS) kept.delete(name);
  delete replayed.body;
  replayed.method = 'GET';
  return replayed;
}

/**
 * Fetch restreint : https uniquement, hôte validé sur sa forme ET sur son
 * adresse résolue (jamais localhost, privé ou réservé), à CHAQUE saut. Les
 * redirections sont suivies à la main : laissées au runtime, une adresse
 * publique qui redirige vers le réseau interne passerait la garde. Le délai
 * couvre toute la chaîne (30 s par défaut ; `timeoutMs: null` le laisse au
 * signal de l'appelant). Le corps n'est pas plafonné ici (la réponse est
 * rendue en flux) : `safeFetchText`, `safeFetchBytes` et `safeFetchJson` le
 * lisent avec un plafond.
 */
export async function safeFetch(url: string, init?: SafeFetchInit): Promise<Response> {
  const { timeoutMs = SAFE_FETCH_TIMEOUT_MS, signal, redirect = 'follow', ...rest } = init ?? {};
  const deadline = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs);
  let current = assertSafeUrl(url);
  let request: RequestInit = {
    ...rest,
    redirect: 'manual',
    signal: deadline && signal ? AbortSignal.any([signal, deadline]) : (deadline ?? signal ?? undefined),
  };
  for (let hop = 0; ; hop += 1) {
    await assertPublicHost(current.hostname);
    const response = await fetch(current, request);
    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || !location) return response;
    if (redirect === 'manual') return response;
    await discardBody(response);
    if (redirect === 'error') throw new Error(`Redirection refusée : ${current.href} renvoie vers ${location}`);
    if (hop >= MAX_REDIRECTS) throw new Error(`Trop de redirections (plus de ${MAX_REDIRECTS}) : ${url}`);
    const next = assertSafeUrl(new URL(location, current).href);
    request = redirectedRequest(request, response.status, current, next);
    current = next;
  }
}

/** Taille par défaut maximale d'une réponse lue en entier. */
export const SAFE_BODY_MAX_BYTES = 5 * 1024 * 1024;

export type BoundedInit = SafeFetchInit & { maxBytes?: number };

/** Une taille lisible (octets, Ko ou Mo), pour les messages. */
function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} Mo`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${bytes} octets`;
}

/** Une réponse plus grosse que ce que l'appelant accepte de lire. */
export class OversizedResponseError extends Error {
  constructor(maxBytes: number) {
    super(`Réponse trop lourde (plafond : ${sizeLabel(maxBytes)}) : lecture interrompue.`);
    this.name = 'OversizedResponseError';
  }
}

/**
 * Lit un corps de réponse avec un plafond ferme : la longueur déclarée, puis
 * les octets réellement reçus. Un serveur qui annonce peu et envoie beaucoup
 * est coupé dès que le plafond est dépassé.
 */
async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discardBody(response);
    throw new OversizedResponseError(maxBytes);
  }
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new OversizedResponseError(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/** Requête sûre, corps lu comme texte brut avec un plafond de taille. */
export async function safeFetchText(url: string, init?: BoundedInit): Promise<string> {
  const { maxBytes = SAFE_BODY_MAX_BYTES, ...rest } = init ?? {};
  return (await readBounded(await safeFetch(url, rest), maxBytes)).toString('utf8');
}

/** Requête sûre, corps lu comme octets avec un plafond de taille. */
export async function safeFetchBytes(url: string, init?: BoundedInit): Promise<Buffer> {
  const { maxBytes = SAFE_BODY_MAX_BYTES, ...rest } = init ?? {};
  return readBounded(await safeFetch(url, rest), maxBytes);
}

/** Requête sûre, corps lu comme JSON avec un plafond de taille (un corps vide ou non JSON lève une erreur). */
export async function safeFetchJson<T>(url: string, init?: BoundedInit): Promise<T> {
  return JSON.parse(await safeFetchText(url, init)) as T;
}
