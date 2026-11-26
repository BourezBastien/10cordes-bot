import { Prisma } from '../../../../generated/prisma/client.mts';

/*
 * PORTS DE LA MIGRATION. La source n'est jamais écrite : la migration ne la
 * voit que par des interfaces de lecture. (Le client libsql n'a pas de mode
 * lecture seule : constaté le 26/11/2026, `?mode=ro` lui est refusé. Le
 * garde-fou est donc dans le type : aucun code de la migration ne détient de
 * quoi écrire dans la source.)
 *
 * Les lignes passent par l'API de Prisma (findMany, createMany, count), jamais
 * par du SQL écrit à la main : un nom de table ou de colonne ne se lie pas en
 * paramètre, et ici il n'y a rien à lier ni à citer. Il ne reste qu'une requête,
 * à texte fixe : les tables de la source.
 */

/** Une ligne telle que Prisma la rend : nom de colonne à valeur. */
export type Row = Record<string, unknown>;

/** Les arguments de lecture que la migration écrit : un filtre, et pour avancer par lots un ordre et un nombre. */
export interface ReadArgs {
  where?: Record<string, unknown>;
  orderBy?: readonly Record<string, 'asc'>[];
  take?: number;
}

/** Un modèle, tel que la migration le lit. */
export interface ModelPort {
  findMany(args: ReadArgs): Promise<Row[]>;
}

/** Un modèle, tel que la migration l'écrit dans la cible. */
export interface WritableModelPort extends ModelPort {
  /** Écrit des lignes, en ignorant celles dont la clé existe déjà : la reprise d'une migration interrompue est sans effet. */
  createMany(args: { data: Row[]; skipDuplicates: true }): Promise<{ count: number }>;
  count(): Promise<number>;
}

/** Une base vue par ses modèles, en lecture seule. */
export interface ModelReader {
  model(name: string): ModelPort;
}

/** La cible : ses modèles, en lecture et en écriture. */
export interface ModelTarget {
  model(name: string): ModelPort;
  writable(name: string): WritableModelPort;
}

/** Un client Prisma réduit à ses modèles, en lecture : la source, ou la cible pour les relire. */
export function readerOf(client: object): ModelReader {
  return { model: (name) => modelPortOf(client, name) };
}

/** Un client Prisma réduit à ses modèles, en lecture et en écriture : la cible. */
export function targetOf(client: object): ModelTarget {
  return {
    model: (name) => modelPortOf(client, name),
    writable: (name) => modelPortOf(client, name) as WritableModelPort,
  };
}

/** Les tables d'une base SQLite, hors ses tables internes (prisma-cli.mjs et la migration s'en servent pour dire ce qui n'est pas copié). */
export async function sqliteTablesOf(client: { $queryRaw<T>(query: Prisma.Sql): Promise<T> }): Promise<string[]> {
  const rows = await client.$queryRaw<Array<{ name: string }>>(
    Prisma.sql`SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" NOT LIKE 'sqlite_%' ORDER BY "name"`,
  );
  return rows.map((row) => row.name);
}

/** Le délégué d'un modèle sur un client Prisma : une propriété de l'instance, nommée comme le modèle. */
function modelPortOf(client: object, name: string): ModelPort {
  const port = (client as Record<string, ModelPort | undefined>)[name];
  if (!port || typeof port.findMany !== 'function') throw new Error(`Modèle introuvable sur le client Prisma : ${name}`);
  return port;
}
