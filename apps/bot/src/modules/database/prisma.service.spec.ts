import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindShutdown } from '../health/shutdown.runtime';
import { PrismaService } from './prisma.service';

/**
 * Le service de la base, sur le vrai client Prisma 7 : son adaptateur est reçu
 * à la construction, il attend la vidange avant de fermer, et il refuse de
 * démarrer sur une base sans ses tables (une base vide ne se prend jamais pour
 * vide en silence). Seule la fabrique d'adaptateur est remplacée : la classe
 * de base du client est la vraie, et ces tests n'ouvrent ni fichier, ni serveur.
 */

const fake = vi.hoisted(() => ({ provider: 'sqlite' as 'sqlite' | 'postgres' }));

vi.mock('./database-client', async (load) => ({
  ...(await load<typeof import('./database-client')>()),
  databaseAdapterOf: () => ({ provider: fake.provider }),
}));

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Barres obliques partout, comme l'adresse résolue. */
const slashes = (value: string): string => value.split('\\').join('/');

afterEach(() => {
  bindShutdown({ isDraining: () => false, drained: async () => true, track: (work) => work });
  fake.provider = 'sqlite';
});

describe('PrismaService', () => {
  it('la base attend la fin de la vidange avant de se fermer', async () => {
    const order: string[] = [];
    bindShutdown({
      isDraining: () => true,
      track: (work) => work,
      drained: async () => {
        await tick();
        order.push('vidange soldée');
        return true;
      },
    });
    const prisma = new PrismaService({ DATABASE_URL: 'file:./data/bot.db' } as never);
    vi.spyOn(prisma, '$disconnect').mockImplementation(async () => {
      order.push('base fermée');
    });
    await prisma.onShutdown();
    expect(order).toEqual(['vidange soldée', 'base fermée']);
  });

  it('reçoit son adaptateur à la construction, sur l’adresse de l’environnement, et garde l’adresse résolue', () => {
    const prisma = new PrismaService({ DATABASE_URL: 'file:./data/bot.db' } as never);
    expect(prisma.databaseUrl).toBe(`file:${slashes(join(process.cwd(), 'data', 'bot.db'))}`);
  });

  it('expose ses méthodes de cycle de vie et son dialecte sur l’instance construite, quel que soit le moteur', () => {
    // Le moteur vient de l'adresse ; l'adaptateur, lui, dit `postgres` (son nom à lui).
    const cases = [
      { adapter: 'sqlite', url: 'file:./data/bot.db', engine: 'sqlite' },
      { adapter: 'postgres', url: 'postgresql://u:p@db:5432/bot', engine: 'postgresql' },
    ] as const;
    for (const { adapter, url, engine } of cases) {
      fake.provider = adapter;
      const prisma = new PrismaService({ DATABASE_URL: url } as never);
      expect(typeof prisma.onBoot, engine).toBe('function');
      expect(typeof prisma.onShutdown, engine).toBe('function');
      expect(prisma.dialect.provider, engine).toBe(engine);
      expect(typeof prisma.guild.findMany, engine).toBe('function');
    }
  });

  it('refuse de démarrer sur une base SQLite absente, en nommant le fichier : jamais de base vide en silence', async () => {
    const dir = mkdtempSync(join(tmpdir(), '10cordes-absente-'));
    try {
      const prisma = new PrismaService({ DATABASE_URL: `file:${join(dir, 'bot.db')}` } as never);
      const connect = vi.spyOn(prisma, '$connect');
      await expect(prisma.onBoot()).rejects.toThrow(/La base SQLite n.existe pas : .*bot\.db/u);
      expect(connect).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 });
    }
  });

  it('sur PostgreSQL : une base sans ses tables est refusée avant toute connexion, sans lire un fichier', async () => {
    fake.provider = 'postgres';
    const prisma = new PrismaService({ DATABASE_URL: 'postgresql://u:p@db:5432/bot' } as never);
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ present: 0 }]);
    const connect = vi.spyOn(prisma, '$connect');
    await expect(prisma.onBoot()).rejects.toThrow(/La base PostgreSQL n.a pas ses tables .*pnpm db:deploy/u);
    expect(connect).not.toHaveBeenCalled();
  });

  it('sur PostgreSQL : la connexion s’ouvre quand les tables sont là', async () => {
    fake.provider = 'postgres';
    const prisma = new PrismaService({ DATABASE_URL: 'postgresql://u:p@db:5432/bot' } as never);
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ present: 1 }]);
    const connect = vi.spyOn(prisma, '$connect').mockResolvedValue(undefined);
    await prisma.onBoot();
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
