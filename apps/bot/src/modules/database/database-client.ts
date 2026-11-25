/*
 * CLIENT PRISMA 7 ET SON ADAPTATEUR DE PILOTAGE, UNE SEULE FABRIQUE pour tous
 * ceux qui ouvrent la base : PrismaService (le graphe d'injection), l'instance
 * better-auth (créée hors de ce graphe) et les scripts d'exploitation .mjs,
 * que Node lit directement (d'où l'extension du module généré : en ESM natif,
 * un import relatif porte son extension).
 *
 * SQLite par l'adaptateur libsql (JavaScript et binaires fournis, rien à
 * compiler). Le format des dates est fixé : `unixepoch-ms`, celui de Prisma 6.
 * Par défaut, Prisma 7 les écrit en texte ISO ; une base écrite par Prisma 6
 * garde ses dates en entiers, et tout filtre par date y aurait alors rendu
 * faux sans un mot (« createdAt >= hier » : 0 ligne, « createdAt < 2100 » :
 * tout). Vérifié sur une copie de la base le 25/11/2026.
 */
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '../../../generated/prisma/client.mts';
import { databaseUrlOf } from './database-url.ts';

/** Format des dates écrit en SQLite : des entiers, en millisecondes. */
export const SQLITE_TIMESTAMP_FORMAT = 'unixepoch-ms' as const;

/** L'adaptateur de la base désignée par `url` (relative au projet, voir database-url.ts). */
export function databaseAdapterOf(url: string | undefined, projectDir: string = process.cwd()): PrismaLibSql {
  return new PrismaLibSql({ url: databaseUrlOf(url, projectDir) }, { timestampFormat: SQLITE_TIMESTAMP_FORMAT });
}

/** Un client Prisma sur l'adaptateur ; non connecté tant que `$connect` n'est pas appelé. */
export function createDatabaseClient(url: string | undefined, projectDir?: string): PrismaClient {
  return new PrismaClient({ adapter: databaseAdapterOf(url, projectDir) });
}
