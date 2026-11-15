import { Injectable, type SpraxiumOnBoot, type SpraxiumOnShutdown } from '@spraxium/common';
import { PrismaClient } from '@prisma/client';
import { AppEnv } from '../../app.env';

/** Client Prisma unique — injectable partout, connecté au boot, déconnecté au shutdown. */
@Injectable()
export class PrismaService extends PrismaClient implements SpraxiumOnBoot, SpraxiumOnShutdown {
  constructor(env: AppEnv) {
    super({ datasources: { db: { url: env.DATABASE_URL } } });
  }

  async onBoot(): Promise<void> {
    await this.$connect();
  }

  async onShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
