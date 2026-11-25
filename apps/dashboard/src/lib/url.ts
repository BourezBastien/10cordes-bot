/*
 * ADRESSES. Un contrôle d'écriture, côté panneau, pour répondre tout de
 * suite : https obligatoire, et refus des hôtes visiblement privés ou
 * locaux. Le vrai gardien est le bot, qui résout le nom avant chaque requête
 * (shared/utils/safe-fetch.ts) : un nom public qui pointe vers une adresse
 * privée n'est vu que par lui.
 */

const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\..*|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2\d|3[01])\..*|\[::1\]|\[f[cd].*\]|\[fe80:.*)$/iu;

/** Le motif des hôtes privés ou locaux, exposé pour les tests. */
export { PRIVATE_HOST };

export function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return !PRIVATE_HOST.test(url.hostname);
}

/** L'URL sans son protocole : l'hôte, puis le chemin et la requête. */
export function splitUrl(url: string): { host: string; path: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, path: `${parsed.pathname}${parsed.search}` };
  } catch {
    return { host: url, path: '' };
  }
}
