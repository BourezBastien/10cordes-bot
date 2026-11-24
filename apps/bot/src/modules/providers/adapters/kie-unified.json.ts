/**
 * Lectures défensives du JSON d'un fournisseur : sa forme n'est jamais
 * garantie (modèle, version d'API, passerelle), on ne lève jamais sur une
 * propriété absente.
 */

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Retire les champs vides : un paramètre absent n'est jamais envoyé (`undefined` ou `null`). */
export function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null));
}

/** Masque la clé quand un fournisseur la renvoie dans un message d'erreur. */
export function redactSecret(text: string, secret: string | null): string {
  return secret && secret.length >= 4 ? text.split(secret).join('[clé masquée]') : text;
}

/** Vrai si une donnée issue du fournisseur recopie la clé : elle ne sera jamais rendue. */
export function carriesSecret(value: unknown, secret: string | null): boolean {
  return secret !== null && secret.length >= 4 && JSON.stringify(value).includes(secret);
}
