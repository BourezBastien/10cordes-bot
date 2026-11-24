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
 * localhost / privé / réservé. Exportée pour les consommateurs non-fetch
 * (ex : passer une URL à ffmpeg dans le module vocal).
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
 * Fetch restreint : https uniquement, host validé (jamais localhost / privé / réservé).
 * Utilisé pour télécharger des fichiers distants fournis par des interactions (ex: import de config)
 * et appeler des APIs externes (ex: PixelLab).
 */
export async function safeFetch(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const parsed = assertSafeUrl(url);
  const { timeoutMs = 30_000, signal, ...rest } = init ?? {};
  // Le délai s'ajoute au signal de l'appelant (il ne le remplace pas) : une capacité annulée l'est vraiment.
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(parsed, { ...rest, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
}
