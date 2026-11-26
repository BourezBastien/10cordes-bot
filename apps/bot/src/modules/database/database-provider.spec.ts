import { describe, expect, it } from 'vitest';
import { databaseProviderOf, isSqliteUrl } from './database-provider';
import { dialectOf, epochMsOf } from './sql-dialect';
import { Prisma } from '../../../generated/prisma/client.mts';

/**
 * Le moteur de la base, lu à l'adresse : une seule règle pour la fabrique
 * (quel adaptateur, quel client), le service (quel dialecte, quel garde-fou)
 * et la CLI (quelle configuration). Une adresse inconnue est refusée sans que
 * sa valeur paraisse : elle peut porter un mot de passe.
 */

describe('databaseProviderOf', () => {
  it('sans adresse, ou un fichier : SQLite, l’ancienne base', () => {
    expect(databaseProviderOf(undefined)).toBe('sqlite');
    expect(databaseProviderOf('')).toBe('sqlite');
    expect(databaseProviderOf('   ')).toBe('sqlite');
    expect(databaseProviderOf('file:./data/bot.db')).toBe('sqlite');
  });

  it('un serveur PostgreSQL, aux deux écritures de son schéma', () => {
    expect(databaseProviderOf('postgresql://u:p@db:5432/bot')).toBe('postgresql');
    expect(databaseProviderOf(' postgres://db:5432/bot ')).toBe('postgresql');
  });

  it('une adresse d’un autre moteur est refusée, sans que sa valeur paraisse', () => {
    const SECRET = 'mot-de-passe-de-test';
    for (const url of [`libsql://u:${SECRET}@db.example.test`, `https://u:${SECRET}@example.test/db`, 'mysql://db/bot', 'postgresql:/incomplet']) {
      let message = '';
      expect(() => {
        try {
          databaseProviderOf(url);
        } catch (error) {
          message = String((error as Error).message);
          throw error;
        }
      }, url).toThrow(/DATABASE_URL n.est pas une adresse de base reconnue/u);
      expect(message, url).not.toContain(SECRET);
      expect(message, url).toContain('file:<chemin>');
      expect(message, url).toContain('postgresql://');
    }
  });
});

describe('isSqliteUrl', () => {
  it('une adresse SQLite est reconnue à son schéma ; un serveur ou une adresse inconnue non', () => {
    expect(isSqliteUrl('file:./data/bot.db')).toBe(true);
    for (const url of ['postgresql://db:5432/bot', 'https://example.test/db', '']) expect(isSqliteUrl(url), url).toBe(false);
  });
});

describe('epochMsOf', () => {
  it('un instant lu en SQL brut devient des millisecondes, quel que soit le moteur', () => {
    expect(epochMsOf(new Date('2026-11-25T22:45:10.456Z'))).toBe(Date.parse('2026-11-25T22:45:10.456Z'));
    expect(epochMsOf(1_795_646_710_456)).toBe(1_795_646_710_456);
    expect(epochMsOf(1_795_646_710_456n)).toBe(1_795_646_710_456);
    expect(epochMsOf(0)).toBe(0);
  });

  it('sans instant : null (pas zéro)', () => {
    for (const value of [null, undefined, '2026-11-25', {}]) expect(epochMsOf(value)).toBeNull();
  });
});

describe('dialectOf', () => {
  it('chaque moteur a son dialecte', () => {
    expect(dialectOf('sqlite').provider).toBe('sqlite');
    expect(dialectOf('postgresql').provider).toBe('postgresql');
  });

  it('SQLite : le jour vient de strftime sur des millisecondes, et la recherche ignore la casse d’elle-même', () => {
    const dialect = dialectOf('sqlite');
    const day = dialect.dayOf(Prisma.sql`"createdAt"`);
    expect(day.sql).toBe(`strftime('%Y-%m-%d', "createdAt" / 1000, 'unixepoch', 'localtime')`);
    expect(day.values).toEqual([]);
    expect(dialect.textContains('paris')).toEqual({ contains: 'paris' });
  });

  it('PostgreSQL : le jour vient de date_trunc dans le fuseau du processus, passé en paramètre, et la recherche force l’insensibilité à la casse', () => {
    const dialect = dialectOf('postgresql');
    const day = dialect.dayOf(Prisma.sql`"createdAt"`);
    expect(day.sql).toBe(`to_char(date_trunc('day', "createdAt" AT TIME ZONE ?), 'YYYY-MM-DD')`);
    // Le fuseau est lié, jamais écrit dans le SQL : un nom inconnu de PostgreSQL serait refusé par lui.
    expect(day.values).toEqual([Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC']);
    expect(dialect.textContains('paris')).toEqual({ contains: 'paris', mode: 'insensitive' });
  });
});
