import { vi } from 'vitest';

/**
 * Base en mémoire pour les specs : les tables que les services écrivent, avec
 * les mêmes clés uniques (contraintes composées comprises). Les colonnes JSON
 * restent des chaînes, comme en base ; les secrets y sont chiffrés par les
 * services eux-mêmes, avec la clé maîtresse de test (`test-key-not-real`).
 * Aucune cascade : ce que la base fait à la suppression (routes d'un
 * fournisseur retiré) ne se teste pas ici.
 */

type Row = { id: string } & Record<string, unknown>;
type Where = Record<string, unknown>;
type Args = { where?: Where; create?: Where; update?: Where; data?: Where };

/** Filtre Prisma réduit : égalité, OR / AND / NOT, `contains`, clés composées. */
function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as Where[]).some((clause) => matches(row, clause));
    if (key === 'AND') return (value as Where[]).every((clause) => matches(row, clause));
    if (key === 'NOT') return !(value as Where[]).some((clause) => matches(row, clause));
    const column = row[key];
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Where);
      // Contrainte unique composée (guildId_slug, guildId_capability) : chacun de ses champs doit correspondre.
      if (column === undefined && entries.every(([field]) => field in row)) return entries.every(([field, expected]) => row[field] === expected);
      const [operator, operand] = entries[0] ?? [];
      return operator === 'contains' ? typeof column === 'string' && column.includes(String(operand)) : false;
    }
    return column === value;
  });
}

function table<T extends Row>(seed: T[] = []) {
  const rows = new Map<string, T>(seed.map((row) => [row.id, row]));
  const all = () => [...rows.values()];
  const find = (where: Where = {}) => all().find((row) => matches(row, where)) ?? null;
  // Comme Prisma : un champ à `undefined` dans une mise à jour laisse la valeur en place.
  const defined = (data: Where = {}) => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  let sequence = 0;
  return {
    rows,
    findMany: vi.fn(async (args: Args = {}) => all().filter((row) => matches(row, args.where ?? {}))),
    findFirst: vi.fn(async (args: Args) => find(args.where)),
    findUnique: vi.fn(async (args: Args) => find(args.where)),
    count: vi.fn(async (args: Args = {}) => all().filter((row) => matches(row, args.where ?? {})).length),
    upsert: vi.fn(async (args: Required<Pick<Args, 'where' | 'create' | 'update'>>) => {
      const existing = find(args.where);
      if (existing) return Object.assign(existing, defined(args.update));
      const row = { ...args.create } as T;
      row.id = String(args.create.id ?? `row-${++sequence}`);
      rows.set(row.id, row);
      return row;
    }),
    update: vi.fn(async (args: Required<Pick<Args, 'where' | 'data'>>) => {
      const row = find(args.where);
      if (!row) throw new Error('Ligne introuvable (mise à jour).');
      return Object.assign(row, defined(args.data));
    }),
    delete: vi.fn(async (args: Args) => {
      const row = find(args.where);
      if (row) rows.delete(row.id);
      return row;
    }),
    deleteMany: vi.fn(async (args: Args = {}) => {
      const hit = all().filter((row) => matches(row, args.where ?? {}));
      for (const row of hit) rows.delete(row.id);
      return { count: hit.length };
    }),
  };
}

export type FakeDb = ReturnType<typeof fakeDb>;

export function fakeDb() {
  return {
    guild: table(),
    auditLog: table(),
    guildProvider: table(),
    capabilityRoute: table(),
    integrationConfig: table(),
    guildIntegration: table(),
  };
}
