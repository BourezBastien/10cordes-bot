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
 * Fetch restreint : https uniquement, host validé (jamais localhost / privé / réservé).
 * Utilisé pour télécharger des fichiers distants fournis par des interactions (ex: import de config).
 */
export async function safeFetch(url: string): Promise<Response> {
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
  return fetch(parsed);
}
