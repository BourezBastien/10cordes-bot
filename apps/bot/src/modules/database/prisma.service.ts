import { Injectable, type SpraxiumOnBoot, type SpraxiumOnShutdown } from '@spraxium/common';
import { existsSync } from 'node:fs';
import { AppEnv } from '../../app.env';
import { awaitShutdownDrained } from '../health/shutdown.runtime';
import { databaseAdapterOf } from './database-client';
import { databaseUrlOf, sqliteFileOf } from './database-url';
import { PrismaClient } from '../../../generated/prisma/client.mts';

/**
 * Client Prisma unique : injectable partout, connecté au boot, déconnecté au
 * shutdown. À l'extinction, la base se ferme EN DERNIER : les crochets du
 * framework courent en parallèle, et une demande en cours (une réponse à
 * écrire, une ligne d'audit) a encore besoin d'elle jusqu'à son terme.
 *
 * Le client reçoit son adaptateur de pilote à la construction (Prisma 7) : la
 * fabrique est partagée avec better-auth et les scripts d'exploitation
 * (database-client.ts), et le format des dates y est fixé une fois.
 */
@Injectable()
export class PrismaService extends PrismaClient implements SpraxiumOnBoot, SpraxiumOnShutdown {
  /** L'adresse de la base, résolue (chemin absolu pour un fichier SQLite). */
  readonly databaseUrl: string;

  constructor(env: AppEnv) {
    super({ adapter: databaseAdapterOf(env.DATABASE_URL) });
    this.databaseUrl = databaseUrlOf(env.DATABASE_URL);
  }

  async onBoot(): Promise<void> {
    // Une base SQLite qui n'existe pas n'est jamais créée en silence : une
    // adresse qui pointe ailleurs (un dossier courant, un chemin mal résolu)
    // donnerait un bot vide, sans une erreur. Les migrations la créent.
    const file = sqliteFileOf(this.databaseUrl);
    if (file !== null && !existsSync(file)) {
      throw new Error(
        `La base SQLite n'existe pas : ${file}. Lance les migrations depuis apps/bot (pnpm exec prisma migrate deploy), ou règle DATABASE_URL.`,
      );
    }
    await this.$connect();
  }

  async onShutdown(): Promise<void> {
    // Sans extinction en cours, ou une vidange déjà soldée : la fermeture est immédiate.
    await awaitShutdownDrained();
    await this.$disconnect();
  }
}
