import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as SqlitePrismaClient } from '../../../generated/prisma-sqlite/client.mts';
import { PrismaClient } from '../../../generated/prisma/client.mts';
import { PrismaClientBase, createDatabaseClient, databaseAdapterOf } from './database-client';

/**
 * La fabrique du client Prisma : un adaptateur par moteur, et le client réel
 * choisi d'après cet adaptateur (jamais d'après l'environnement lu au chargement
 * d'un module). PostgreSQL n'est pas joint ici : un adaptateur pg ne connecte
 * rien avant que le client ne s'y connecte, et sa classe suffit à prouver le
 * choix. La base PostgreSQL réelle est couverte par la spécification
 * d'intégration (database.postgres.spec.ts), quand un serveur de test est donné.
 */

const PROJECT = process.platform === 'win32' ? 'C:\\proj\\apps\\bot' : '/proj/apps/bot';

describe('databaseAdapterOf', () => {
  it('une adresse PostgreSQL donne l’adaptateur pg, qui déclare son moteur `postgres`', () => {
    const adapter = databaseAdapterOf('postgresql://u:p@db:5432/bot', PROJECT);
    expect(adapter).toBeInstanceOf(PrismaPg);
    expect(adapter.provider).toBe('postgres');
  });

  it('une adresse SQLite donne l’adaptateur libsql, qui déclare son moteur `sqlite`', () => {
    const adapter = databaseAdapterOf('file:./data/bot.db', PROJECT);
    expect(adapter).toBeInstanceOf(PrismaLibSql);
    expect(adapter.provider).toBe('sqlite');
  });

  it('une adresse d’un autre moteur est refusée, sans que sa valeur paraisse', () => {
    let message = '';
    try {
      databaseAdapterOf('mysql://u:secret@db/bot', PROJECT);
    } catch (error) {
      message = String((error as Error).message);
    }
    expect(message).toMatch(/adresse de base reconnue/u);
    expect(message).not.toContain('secret');
  });
});

describe('PrismaClientBase', () => {
  it('le client réel suit le moteur de l’adaptateur reçu : le prototype de la base s’enchaîne sur le sien', () => {
    new PrismaClientBase({ adapter: { provider: 'postgres' } as never });
    expect(Object.getPrototypeOf(PrismaClientBase.prototype)).toBe(PrismaClient.prototype);
    new PrismaClientBase({ adapter: { provider: 'sqlite' } as never });
    expect(Object.getPrototypeOf(PrismaClientBase.prototype)).toBe(SqlitePrismaClient.prototype);
    new PrismaClientBase({ adapter: { provider: 'postgres' } as never });
    expect(Object.getPrototypeOf(PrismaClientBase.prototype)).toBe(PrismaClient.prototype);
  });

  it('une sous-classe garde ses méthodes et ses champs sur l’instance construite', () => {
    class Probe extends PrismaClientBase {
      readonly marker = 'sous-classe';
      answer(): number {
        return 42;
      }
    }
    const probe = new Probe({ adapter: { provider: 'sqlite' } as never });
    expect(probe.marker).toBe('sous-classe');
    expect(probe.answer()).toBe(42);
    expect(typeof probe.$connect).toBe('function');
  });

  it('un adaptateur que le client du moteur refuse reste refusé : la fabrique ne corrige rien', () => {
    // Un moteur inconnu tombe sur le client SQLite, qui attend `sqlite` : Prisma lève lui-même.
    expect(() => new PrismaClientBase({ adapter: { provider: 'mysql' } as never })).toThrow();
  });
});

describe('createDatabaseClient sur une base SQLite réelle', () => {
  it('écrit et relit par le client du moteur, aux millisecondes et aux booléens près', async () => {
    const dir = mkdtempSync(join(tmpdir(), '10cordes-fabrique-'));
    const prisma = createDatabaseClient(`file:${join(dir, 'fabrique.db')}`);
    try {
      const at = new Date('2026-11-25T22:45:10.456Z');
      await prisma.$executeRawUnsafe('CREATE TABLE "probe" ("id" TEXT NOT NULL PRIMARY KEY, "at" DATETIME NOT NULL, "ok" BOOLEAN NOT NULL)');
      await prisma.$executeRaw`INSERT INTO "probe" ("id", "at", "ok") VALUES (${'a'}, ${at}, ${true})`;
      const rows = await prisma.$queryRaw<Array<{ id: string; at: unknown; ok: unknown }>>`SELECT "id", "at", "ok" FROM "probe"`;
      // Une colonne lue telle quelle revient typée par Prisma d'après le type déclaré de la colonne
      // (DATETIME en Date, BOOLEAN en booléen) ; c'est un agrégat, lui, qui revient brut (MIN d'une date : un nombre).
      expect(rows).toEqual([{ id: 'a', at, ok: true }]);
    } finally {
      await prisma.$disconnect();
      // Sous Windows, le pilote libsql garde le fichier un certain temps après la déconnexion.
      // La suppression se retente une seconde, puis on renonce (dossier jetable du dossier temporaire).
      for (let attempt = 0; attempt < 10 && existsSync(dir); attempt += 1) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
  }, 15_000);
});
