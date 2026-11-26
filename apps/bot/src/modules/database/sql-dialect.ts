import { Prisma } from '../../../generated/prisma/client.mts';
import type { DatabaseProvider } from './database-provider';

/*
 * CE QUI CHANGE D'UN MOTEUR À L'AUTRE dans le SQL écrit à la main. Les deux
 * bases sont servies par le même code pendant la migration : toute requête
 * brute passe par ici dès qu'elle touche à ce qui diffère. Mesuré sur les
 * deux moteurs le 26/11/2026 (un même jeu d'essais, mêmes millisecondes) :
 *
 * - le jour local d'une date : `strftime(..., 'localtime')` en SQLite,
 *   `date_trunc(... AT TIME ZONE <fuseau du processus>)` en PostgreSQL ;
 * - la casse d'une recherche : le LIKE de SQLite ignore la casse, celui de
 *   PostgreSQL non (`mode: 'insensitive'`, que SQLite refuse) ;
 * - et rien d'autre : une borne de date passée en `Date`, `NOT "colonne"` sur
 *   un booléen, `COUNT` et `SUM` convertis par `Number`, `MIN` d'une date par
 *   `epochMsOf` : identiques des deux côtés.
 *
 * Les noms de colonnes viennent du code, jamais d'une entrée : ils sont écrits
 * en clair dans les requêtes (`Prisma.sql\`"createdAt"\``), jamais construits.
 */

/** La part d'un filtre Prisma qui cherche un texte dans une colonne. */
export interface TextContainsFilter {
  contains: string;
  /** PostgreSQL seul : `insensitive` y reproduit le LIKE de SQLite, qui ignore la casse. */
  mode?: 'insensitive';
}

/** Un instant lu en SQL brut (nombre, BigInt ou Date selon le moteur), en millisecondes ; null s'il n'y en a pas. */
export function epochMsOf(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  return typeof value === 'number' || typeof value === 'bigint' ? Number(value) : null;
}

export abstract class SqlDialect {
  constructor(readonly provider: DatabaseProvider) {}

  /** Le jour local du processus d'une colonne de date, en `AAAA-MM-JJ`. */
  abstract dayOf(column: Prisma.Sql): Prisma.Sql;

  /** Filtre `contains` d'une colonne texte qui ignore la casse, sur les deux moteurs. */
  abstract textContains(text: string): TextContainsFilter;
}

/** SQL écrit à la main pour SQLite : les dates sont des entiers en millisecondes (database-client.ts). */
export class SqliteDialect extends SqlDialect {
  constructor() {
    super('sqlite');
  }

  dayOf(column: Prisma.Sql): Prisma.Sql {
    // `strftime` ne lit pas l'entier tel quel (il rendrait NULL : tous les jours sous « null »), d'où le / 1000.
    return Prisma.sql`strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch', 'localtime')`;
  }

  textContains(text: string): TextContainsFilter {
    // Le LIKE de SQLite ignore déjà la casse ; `mode` lui est refusé.
    return { contains: text };
  }
}

/** SQL écrit à la main pour PostgreSQL : les dates sont des Timestamptz(3), des instants absolus. */
export class PostgresDialect extends SqlDialect {
  /** Le fuseau du processus (nom IANA) : le même que celui des jours comptés en JavaScript. */
  private readonly zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  constructor() {
    super('postgresql');
  }

  dayOf(column: Prisma.Sql): Prisma.Sql {
    // L'instant est d'abord ramené à l'heure du processus, puis tronqué au jour.
    return Prisma.sql`to_char(date_trunc('day', ${column} AT TIME ZONE ${this.zone}), 'YYYY-MM-DD')`;
  }

  textContains(text: string): TextContainsFilter {
    return { contains: text, mode: 'insensitive' };
  }
}

/** Le dialecte d'un moteur. */
export function dialectOf(provider: DatabaseProvider): SqlDialect {
  return provider === 'postgresql' ? new PostgresDialect() : new SqliteDialect();
}
