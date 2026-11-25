/**
 * Origines autorisées du dashboard. `DASHBOARD_ORIGIN` en accepte plusieurs,
 * séparées par des virgules ou des espaces : elles servent au CORS, à
 * better-auth et au contrôle d'origine des requêtes qui modifient.
 */

/** Origines nettoyées : minuscules, sans barre finale, sans doublon, sans vide. */
export function trustedOriginsOf(raw: string | undefined | null): string[] {
  const origins = (raw ?? '')
    .split(/[,\s]+/u)
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => origin !== null);
  return [...new Set(origins)];
}

/**
 * Origine comparable d'une URL ou d'un en-tête `Origin` ; null si illisible.
 * Une origine est celle d'une page : http ou https. Tout autre schéma n'en a
 * pas (le navigateur dit alors « null »), et n'est jamais une origine de
 * confiance.
 */
export function normalizeOrigin(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed === 'null') return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin.toLowerCase() : null;
  } catch {
    return null;
  }
}
