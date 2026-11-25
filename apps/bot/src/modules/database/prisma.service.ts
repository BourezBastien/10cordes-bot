import { Injectable, type SpraxiumOnBoot, type SpraxiumOnShutdown } from '@spraxium/common';
import { PrismaClient } from '@prisma/client';
import { AppEnv } from '../../app.env';
import { awaitShutdownDrained } from '../health/shutdown.runtime';

/**
 * Client Prisma unique : injectable partout, connecté au boot, déconnecté au
 * shutdown. À l'extinction, la base se ferme EN DERNIER : les crochets du
 * framework courent en parallèle, et une demande en cours (une réponse à
 * écrire, une ligne d'audit) a encore besoin d'elle jusqu'à son terme.
 */
@Injectable()
export class PrismaService extends PrismaClient implements SpraxiumOnBoot, SpraxiumOnShutdown {
  constructor(env: AppEnv) {
    super({ datasources: { db: { url: env.DATABASE_URL } } });
  }

  async onBoot(): Promise<void> {
    await this.$connect();
  }

  async onShutdown(): Promise<void> {
    // Sans extinction en cours, ou une vidange déjà soldée : la fermeture est immédiate.
    await awaitShutdownDrained();
    await this.$disconnect();
  }
}
