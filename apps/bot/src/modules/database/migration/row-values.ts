import type { Row } from './migration-ports.ts';
import type { ModelInfo, ScalarType } from './schema-catalog.ts';

/*
 * VALEURS D'UNE LIGNE : ce que la migration admet dans la source, et comment
 * elle en compare deux. Les lignes passent par Prisma des deux côtés, qui rend
 * déjà les dates en `Date`, les booléens en booléens, les entiers en nombres :
 * rien n'est converti ici. La migration contrôle que chaque valeur a bien le
 * type de sa colonne, et refuse tout le reste en nommant la table et la
 * colonne : jamais la valeur.
 */

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

/**
 * Les colonnes qui portent un secret chiffré (AES-256-GCM, voir le schéma).
 * Elles sont copiées et comparées comme les autres, octet pour octet : la
 * migration ne les déchiffre jamais, et elle n'en affiche jamais aucune.
 */
export const SECRET_COLUMNS: readonly string[] = ['apiKey', 'encryptedApiKey', 'encryptedHeaders'];

/** Erreur de valeur : la migration s'arrête en nommant un emplacement, jamais une valeur. */
export class MigrationValueError extends Error {
  constructor(place: string, detail: string) {
    super(`${place} : ${detail}`);
    this.name = 'MigrationValueError';
  }
}

/** Le nom du type JavaScript d'une valeur (pour un message), jamais son contenu. */
function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Une valeur a-t-elle le type de sa colonne ? Un `Int` tient sur 32 bits ; un texte ne porte pas d'octet nul (PostgreSQL le refuse). */
function valueMatches(value: unknown, type: ScalarType): boolean {
  switch (type) {
    case 'String':
      return typeof value === 'string' && !value.includes('\u0000');
    case 'Boolean':
      return typeof value === 'boolean';
    case 'Int':
      return typeof value === 'number' && Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX;
    case 'Float':
      return typeof value === 'number' && Number.isFinite(value);
    case 'DateTime':
      return value instanceof Date && Number.isFinite(value.getTime());
  }
}

/** Contrôle une ligne de la source : chaque champ a le type de sa colonne, ou rien s'il est optionnel. */
export function assertRow(info: ModelInfo, row: Row, place: string): void {
  for (const field of info.fields) {
    const value = row[field.name];
    const where = `${place}.${field.name}`;
    if (value === null || value === undefined) {
      if (!field.optional) throw new MigrationValueError(where, 'valeur absente sur un champ obligatoire');
      continue;
    }
    if (!valueMatches(value, field.type)) {
      // Un texte qui porte un octet nul arrive ici : le détail le dit, sans le montrer.
      const detail = typeof value === 'string' && value.includes('\u0000') ? 'texte contenant un octet nul, que PostgreSQL refuse' : `valeur d'un type inattendu (${kindOf(value)} pour ${field.type})`;
      throw new MigrationValueError(where, detail);
    }
  }
}

/** Vrai si la ligne porte au moins une valeur secrète non vide. */
export function carriesSecret(info: ModelInfo, row: Row): boolean {
  return info.fields.some((field) => SECRET_COLUMNS.includes(field.name) && row[field.name] !== null && row[field.name] !== undefined);
}

/** Deux valeurs d'une même colonne, lues dans la source et dans la cible : égales à la milliseconde et à l'unité près. */
export function valuesEqual(source: unknown, target: unknown): boolean {
  if (source === null || source === undefined) return target === null || target === undefined;
  if (target === null || target === undefined) return false;
  if (source instanceof Date) return target instanceof Date && source.getTime() === target.getTime();
  if (typeof source === 'number') return typeof target === 'number' && source === target;
  return source === target;
}
