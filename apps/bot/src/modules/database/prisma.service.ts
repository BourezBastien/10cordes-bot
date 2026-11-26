import { Injectable, type SpraxiumOnBoot, type SpraxiumOnShutdown } from '@spraxium/common';
import { existsSync } from 'node:fs';
import { AppEnv } from '../../app.env';
import { awaitShutdownDrained } from '../health/shutdown.runtime';
import { PrismaClientBase, databaseAdapterOf } from './database-client';
import { databaseProviderOf } from './database-provider';
import { databaseUrlOf, sqliteFileOf } from './database-url';
import { dialectOf, type SqlDialect } from './sql-dialect';

/**
 * Client Prisma unique : injectable partout, connecté au boot, déconnecté au
 * shutdown. À l'extinction, la base se ferme EN DERNIER : les crochets du
 * framework courent en parallèle, et une demande en cours (une réponse à
 * écrire, une ligne d'audit) a encore besoin d'elle jusqu'à son terme.
 *
 * Le client reçoit son adaptateur de pilote à la construction (Prisma 7) : la
 * fabrique est partagée avec better-auth et les scripts d'exploitation
 * (database-client.ts), et le moteur réel y est choisi, PostgreSQL ou SQLite.
 * `dialect` dit ce qui change d'un moteur à l'autre dans le SQL écrit à la
 * main : toute requête brute qui touche à une date ou à une recherche de
 * texte le consulte.
 */
@Injectable()
export class PrismaService extends PrismaClientBase implements SpraxiumOnBoot, SpraxiumOnShutdown {
  /** L'adresse de la base, résolue (chemin absolu pour un fichier SQLite). */
  readonly databaseUrl: string;

  readonly dialect: SqlDialect;

  constructor(env: AppEnv) {
    super({ adapter: databaseAdapterOf(env.DATABASE_URL) });
    this.databaseUrl = databaseUrlOf(env.DATABASE_URL);
    this.dialect = dialectOf(databaseProviderOf(this.databaseUrl));
  }

  async onBoot(): Promise<void> {
    // Une base sans ses tables n'est jamais prise pour vide en silence : une
    // adresse qui pointe ailleurs (un dossier courant, un chemin mal résolu,
    // un serveur neuf) donnerait un bot vide, sans une erreur. Les migrations
    // les créent (pnpm db:deploy, depuis apps/bot).
    if (this.dialect.provider === 'postgresql') await this.assertPostgresMigrated();
    else this.assertSqliteFileExists();
    await this.$connect();
  }

  async onShutdown(): Promise<void> {
    // Sans extinction en cours, ou une vidange déjà soldée : la fermeture est immédiate.
    await awaitShutdownDrained();
    await this.$disconnect();
  }

  private assertSqliteFileExists(): void {
    const file = sqliteFileOf(this.databaseUrl);
    if (file !== null && !existsSync(file)) {
      throw new Error(`La base SQLite n\u0027existe pas : ${file}. Lance les migrations depuis apps/bot (pnpm db:deploy), ou règle DATABASE_URL.`);
    }
  }

  private async assertPostgresMigrated(): Promise<void> {
    // Par information_schema : `to_regclass` rend un type (`regclass`) que le client ne sait pas lire (vu sur un serveur réel, le 26/11/2026).
    const rows = await this.$queryRaw<Array<{ present: number }>>`SELECT COUNT(*)::int AS "present" FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'guilds'`;
    if ((rows[0]?.present ?? 0) > 0) return;
    throw new Error('La base PostgreSQL n\u0027a pas ses tables (guilds est absente). Lance les migrations depuis apps/bot (pnpm db:deploy) sur le serveur désigné par DATABASE_URL.');
  }
}
