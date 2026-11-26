/*
 * CLIENT PRISMA 7 ET SON ADAPTATEUR DE PILOTAGE, UNE SEULE FABRIQUE pour tous
 * ceux qui ouvrent la base : PrismaService (le graphe d'injection), l'instance
 * better-auth (créée hors de ce graphe) et les scripts d'exploitation .mjs,
 * que Node lit directement (d'où l'extension des modules générés : en ESM
 * natif, un import relatif porte son extension).
 *
 * Deux moteurs, deux clients générés (un client Prisma ne parle qu'à un
 * moteur), un seul type : celui de PostgreSQL, la cible. Les deux schémas
 * décrivent les mêmes modèles (l'un dérive de l'autre, voir
 * prisma/schema.sqlite.prisma), donc le client SQLite répond à la même API.
 *
 * - PostgreSQL : l'adaptateur pg (@prisma/adapter-pg), les dates en Timestamptz(3).
 * - SQLite : l'adaptateur libsql (JavaScript et binaires fournis, rien à
 *   compiler), le format des dates fixé à `unixepoch-ms`, celui de Prisma 6.
 *   Par défaut, Prisma 7 les écrit en texte ISO ; une base écrite par Prisma 6
 *   garde ses dates en entiers, et tout filtre par date y aurait alors rendu
 *   faux sans un mot (« createdAt >= hier » : 0 ligne, « createdAt < 2100 » :
 *   tout). Vérifié sur une copie de la base le 25/11/2026.
 */
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as SqlitePrismaClient } from '../../../generated/prisma-sqlite/client.mts';
import { Prisma, PrismaClient } from '../../../generated/prisma/client.mts';
import { databaseProviderOf } from './database-provider.ts';
import { databaseUrlOf } from './database-url.ts';

/** L'adaptateur de l'un ou l'autre moteur. */
export type DatabaseAdapter = PrismaPg | PrismaLibSql;

/** Format des dates écrit en SQLite : des entiers, en millisecondes. */
export const SQLITE_TIMESTAMP_FORMAT = 'unixepoch-ms' as const;

/** L'adaptateur du moteur de la base désignée par `url` (relative au projet, voir database-url.ts). */
export function databaseAdapterOf(url: string | undefined, projectDir: string = process.cwd()): DatabaseAdapter {
  const resolved = databaseUrlOf(url, projectDir);
  return databaseProviderOf(url) === 'postgresql'
    ? new PrismaPg({ connectionString: resolved })
    : new PrismaLibSql({ url: resolved }, { timestampFormat: SQLITE_TIMESTAMP_FORMAT });
}

/** Les options qu'un client Prisma reçoit : ici, son adaptateur de pilote. */
export type PrismaClientOptions = Prisma.PrismaClientOptions;

/**
 * Classe de base d'un client typé « PostgreSQL », dont le client RÉEL est
 * choisi à la construction d'après le moteur de l'adaptateur reçu
 * (`adapter.provider`, lu sur l'adaptateur et jamais sur l'environnement).
 *
 * Un client généré refuse l'adaptateur d'un autre moteur ; il fallait donc
 * que la classe instanciée dépende de la base, sans lire l'environnement au
 * chargement d'un module et sans réécrire en composition tous les appels
 * `prisma.<modèle>` du bot. Le constructeur construit le client du moteur par
 * `Reflect.construct`, en gardant la sous-classe comme `new.target` : ses
 * méthodes et ses champs (PrismaService) restent ceux de l'instance, et le
 * prototype de cette base s'enchaîne sur celui du client réel.
 */
export const PrismaClientBase = function PrismaClientBase(this: PrismaClient, config: PrismaClientOptions): void {
  const Client = config.adapter?.provider === 'postgres' ? PrismaClient : SqlitePrismaClient;
  Object.setPrototypeOf(PrismaClientBase.prototype, Client.prototype);
  return Reflect.construct(Client, [config], new.target);
} as unknown as new (config: PrismaClientOptions) => PrismaClient;

/** Un client Prisma sur l'adaptateur de sa base ; non connecté tant que `$connect` n'est pas appelé. */
export function createDatabaseClient(url: string | undefined, projectDir?: string): PrismaClient {
  return new PrismaClientBase({ adapter: databaseAdapterOf(url, projectDir) });
}
