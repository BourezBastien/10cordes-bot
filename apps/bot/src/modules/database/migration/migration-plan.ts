import type { ModelInfo } from './schema-catalog.ts';
import type { Row } from './migration-ports.ts';

/*
 * LE PLAN DE COPIE : dans quel ordre copier les modèles, et comment relire une
 * table par lots sans sauter ni répéter une ligne. La lecture avance sur la
 * clé primaire (une ligne après la dernière lue) : le coût reste le même d'un
 * lot à l'autre, là où un OFFSET balayerait toute la table à chaque fois.
 */

/**
 * Les modèles à copier après ceux qu'ils référencent (les clés étrangères de
 * la cible l'exigent). À références égales, par ordre alphabétique : le plan
 * d'un même schéma est toujours le même.
 */
export function orderModels(models: readonly ModelInfo[]): ModelInfo[] {
  const pending = new Map(models.map((model) => [model.name, model]));
  const ordered: ModelInfo[] = [];
  while (pending.size > 0) {
    // Un modèle est prêt quand tout ce qu'il référence est déjà copié, ou n'est pas à copier.
    const ready = [...pending.values()]
      .filter((model) => model.references.every((reference) => !pending.has(reference) || reference === model.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    const next = ready[0];
    if (!next) throw new Error(`Références circulaires entre modèles, aucun ordre de copie possible : ${[...pending.keys()].join(', ')}.`);
    ordered.push(next);
    pending.delete(next.name);
  }
  return ordered;
}

/** La clé d'une ligne : les seules colonnes de la clé primaire, dans l'ordre. */
export function keyOf(info: ModelInfo, row: Row): Row {
  return Object.fromEntries(info.primaryKey.map((column) => [column, row[column]]));
}

/** Lire après cette clé : le filtre « plus grand que », sur une ou plusieurs colonnes. */
export function afterKey(info: ModelInfo, key: Row): Record<string, unknown> {
  const [first, ...rest] = info.primaryKey;
  if (first === undefined) return {};
  const value = key[first];
  if (rest.length === 0) return { [first]: { gt: value } };
  // Sur plusieurs colonnes : plus grand sur la première, ou égal sur la première et plus grand sur la suivante, et ainsi de suite.
  const alternatives = info.primaryKey.map((_column, index) => {
    const equal = Object.fromEntries(info.primaryKey.slice(0, index).map((column) => [column, key[column]]));
    const column = info.primaryKey[index];
    return column === undefined ? equal : { ...equal, [column]: { gt: key[column] } };
  });
  return { OR: alternatives };
}

/** Relire précisément ces clés dans la cible. */
export function whereKeys(info: ModelInfo, keys: readonly Row[]): Record<string, unknown> {
  if (keys.length === 0) return { [info.primaryKey[0] ?? 'id']: { in: [] } };
  if (info.primaryKey.length === 1) return { [info.primaryKey[0] ?? 'id']: { in: keys.map((key) => key[info.primaryKey[0] ?? 'id']) } };
  return { OR: keys.map((key) => Object.fromEntries(info.primaryKey.map((column) => [column, key[column]]))) };
}

/** La clé d'une ligne en un seul texte, pour retrouver la ligne dans une table de correspondance. */
export function keyText(info: ModelInfo, row: Row): string {
  return JSON.stringify(info.primaryKey.map((column) => row[column]));
}

/** L'ordre de lecture : la clé primaire, croissante. Une liste (et non un objet) : Prisma l'exige pour une clé à plusieurs colonnes. */
export function orderByKey(info: ModelInfo): Record<string, 'asc'>[] {
  return info.primaryKey.map((column) => ({ [column]: 'asc' as const }));
}
