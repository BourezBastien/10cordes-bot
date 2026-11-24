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

/**
 * Fetch restreint : https uniquement, hôte validé sur sa forme ET sur son
 * adresse résolue (jamais localhost, privé ou réservé). Utilisé pour
 * télécharger des fichiers distants fournis par des interactions et appeler
 * les API externes.
 */
export async function safeFetch(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const parsed = assertSafeUrl(url);
  await assertPublicHost(parsed.hostname);
  const { timeoutMs = 30_000, signal, ...rest } = init ?? {};
  // Le délai s'ajoute au signal de l'appelant (il ne le remplace pas) : une capacité annulée l'est vraiment.
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(parsed, { ...rest, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
}
