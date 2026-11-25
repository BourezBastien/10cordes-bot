import type { ProviderModel } from './provider.types';

/**
 * Lecture et fusion des colonnes JSON d'un fournisseur (options, en-têtes,
 * catalogue). Les clés réservées (préfixe `_`) marquent l'origine d'un
 * fournisseur : `_source`, `_model`. Un formulaire ne les montre jamais et ne
 * peut pas les perdre.
 */

/** Une valeur est-elle fournie et non vide ? (absent ou vide : « inchangé ») */
export function hasKeys(value: Record<string, unknown> | undefined): boolean {
  return value !== undefined && Object.keys(value).length > 0;
}

/** Clés réservées : l'origine du fournisseur, jamais saisie par un formulaire. */
export function reservedKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key.startsWith('_')));
}

/** Options présentées dans un formulaire : les clés réservées en moins. */
export function visibleOptions(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('_')));
}

/** Colonne JSON d'objet : objet vide si absente ou illisible. */
export function parseRecord(json: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Colonne JSON de catalogue : seules les entrées dotées d'un identifiant sont gardées. */
export function parseModels(json: string | null): ProviderModel[] {
  try {
    const parsed: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) ? (parsed as ProviderModel[]).filter((model) => typeof model?.id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Catalogue après un rafraîchissement : les modèles découverts, puis les
 * slugs saisis à la main que le fournisseur ne liste pas. Un slug saisi à la
 * main que le fournisseur liste désormais garde sa marque : il reste retenu
 * (et retirable) si le catalogue distant change de nouveau.
 */
export function mergeCatalog(discovered: readonly ProviderModel[], previous: readonly ProviderModel[]): ProviderModel[] {
  const manual = new Set(previous.filter((model) => model.origin === 'manual').map((model) => model.id));
  const listed = new Set(discovered.map((model) => model.id));
  return [...discovered.map((model) => (manual.has(model.id) ? { ...model, origin: 'manual' as const } : model)), ...previous.filter((model) => model.origin === 'manual' && !listed.has(model.id))];
}
