import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindShutdown } from '../health/shutdown.runtime';
import { PrismaService } from './prisma.service';

/**
 * Le service de la base, sur le vrai client Prisma 7 : son adaptateur est reçu
 * à la construction, il attend la vidange avant de fermer, et il refuse de
 * démarrer sur un fichier SQLite absent (une base vide ne se crée jamais en
 * silence). L'adaptateur est remplacé : ces tests n'ouvrent aucun fichier.
 */

const adapters = vi.hoisted(() => [] as Array<string | undefined>);

vi.mock('./database-client', () => ({
  databaseAdapterOf: (url: string | undefined) => {
    adapters.push(url);
    // Le client vérifie le fournisseur de son adaptateur à la construction ; il n'est jamais appelé ici.
    return { provider: 'sqlite' };
  },
}));

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Barres obliques partout, comme l'adresse résolue. */
const slashes = (value: string): string => value.split('\\').join('/');

afterEach(() => {
  bindShutdown({ isDraining: () => false, drained: async () => true, track: (work) => work });
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
    expect(adapters.at(-1)).toBe('file:./data/bot.db');
    expect(prisma.databaseUrl).toBe(`file:${slashes(join(process.cwd(), 'data', 'bot.db'))}`);
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
});
