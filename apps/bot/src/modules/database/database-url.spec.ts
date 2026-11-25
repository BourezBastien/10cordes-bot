import { describe, expect, it } from 'vitest';
import { DEFAULT_DATABASE_URL, databaseUrlOf, isSqliteUrl, rawDatabaseUrlOf, sqliteFileOf } from './database-url';

/**
 * La règle d'adresse de la base, la même pour la CLI (prisma.config.ts) et le
 * client (PrismaService, better-auth, les scripts). Un chemin relatif se
 * résout depuis le dossier du projet ; l'ancienne écriture de Prisma 6
 * (`file:../data/bot.db`, relative au schéma) ne désigne plus la même base.
 */

const PROJECT = process.platform === 'win32' ? 'C:\\proj\\apps\\bot' : '/proj/apps/bot';

describe('databaseUrlOf', () => {
  it('sans adresse : la base locale du projet, en chemin absolu', () => {
    const expected = process.platform === 'win32' ? 'file:C:/proj/apps/bot/data/bot.db' : 'file:/proj/apps/bot/data/bot.db';
    expect(rawDatabaseUrlOf(undefined)).toBe(DEFAULT_DATABASE_URL);
    expect(databaseUrlOf(undefined, PROJECT)).toBe(expected);
    expect(databaseUrlOf('   ', PROJECT)).toBe(expected);
  });

  it('une adresse SQLite relative se résout depuis le dossier du projet, barres obliques normales', () => {
    const base = process.platform === 'win32' ? 'file:C:/proj/apps/bot/' : 'file:/proj/apps/bot/';
    expect(databaseUrlOf('file:./data/bot.db', PROJECT)).toBe(`${base}data/bot.db`);
    expect(databaseUrlOf('file:data/x.db', PROJECT)).toBe(`${base}data/x.db`);
    expect(databaseUrlOf('file:.\\data\\x.db', PROJECT)).toBe(`${base}data/x.db`);
  });

  it('une adresse qui remonte d’un dossier sort du projet, sans normaliser en apparence : c’est une autre base', () => {
    const expected = process.platform === 'win32' ? 'file:C:/proj/apps/data/bot.db' : 'file:/proj/apps/data/bot.db';
    expect(databaseUrlOf('file:../data/bot.db', PROJECT)).toBe(expected);
  });

  it('une adresse SQLite absolue reste absolue, sans les barres de tête ni les antislashs', () => {
    const posix = process.platform === 'win32';
    const expected = posix ? 'file:C:/elsewhere/bot.db' : 'file:/elsewhere/bot.db';
    const given = posix ? ['file:C:/elsewhere/bot.db', 'file:///C:/elsewhere/bot.db', 'file:C:\\elsewhere\\bot.db'] : ['file:/elsewhere/bot.db', 'file:\\elsewhere\\bot.db'];
    for (const url of given) expect(databaseUrlOf(url, PROJECT), url).toBe(expected);
  });

  it('l’adresse d’un serveur passe telle quelle, avec ses espaces de bord retirés', () => {
    expect(databaseUrlOf('  postgresql://u:p@db:5432/bot  ', PROJECT)).toBe('postgresql://u:p@db:5432/bot');
    expect(databaseUrlOf('libsql://db.example.test', PROJECT)).toBe('libsql://db.example.test');
  });
});

describe('isSqliteUrl et sqliteFileOf', () => {
  it('une adresse SQLite est reconnue à son schéma, et rend son fichier', () => {
    expect(isSqliteUrl('file:./data/bot.db')).toBe(true);
    expect(sqliteFileOf('file:./data/bot.db')).toBe('./data/bot.db');
    expect(sqliteFileOf('file:///C:/data/bot.db')).toBe('C:/data/bot.db');
    expect(sqliteFileOf('file:C:\\data\\bot.db')).toBe('C:/data/bot.db');
    expect(sqliteFileOf('file:/srv/data/bot.db')).toBe('/srv/data/bot.db');
  });

  it('un serveur n’est ni SQLite ni un fichier', () => {
    for (const url of ['postgresql://db:5432/bot', 'libsql://db.example.test', 'https://example.test/db']) {
      expect(isSqliteUrl(url), url).toBe(false);
      expect(sqliteFileOf(url), url).toBeNull();
    }
  });
});
