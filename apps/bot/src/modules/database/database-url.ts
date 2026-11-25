import path from 'node:path';

/*
 * ADRESSE DE LA BASE. Avec Prisma 7, l'adresse ne traverse plus le schéma :
 * la CLI la lit dans prisma.config.ts, et le client la reçoit par son
 * adaptateur de pilote. Les deux se servent de cette règle, la même.
 *
 * Une adresse SQLite relative (`file:./data/bot.db`) se résout depuis le
 * dossier du projet (apps/bot) : celui de prisma.config.ts, celui d'où le bot
 * est lancé. Jamais depuis l'endroit d'où une commande passe, ni depuis celui
 * du code compilé.
 *
 * Attention à l'ancienne valeur. Sous Prisma 6, le moteur résolvait l'adresse
 * depuis le dossier du schéma (apps/bot/prisma), et `file:../data/bot.db`
 * désignait donc apps/bot/data/bot.db. Résolue depuis apps/bot, la même écriture
 * désigne apps/data/bot.db : ce n'est plus la base. Le fichier ne bouge pas,
 * l'écriture de son adresse change (file:./data/bot.db), et PrismaService
 * refuse de démarrer sur un fichier absent plutôt que d'en créer un vide.
 */

/** Adresse par défaut : la base locale du projet. */
export const DEFAULT_DATABASE_URL = 'file:./data/bot.db';

/** L'adresse telle qu'elle est donnée, ou celle par défaut si elle est vide. */
export function rawDatabaseUrlOf(raw: string | undefined): string {
  return raw?.trim() || DEFAULT_DATABASE_URL;
}

/** Vrai pour une adresse SQLite (un fichier), faux pour tout serveur. */
export function isSqliteUrl(url: string): boolean {
  return url.startsWith('file:');
}

/** Le chemin du fichier d'une adresse SQLite, barres obliques normales ; null pour un serveur. */
export function sqliteFileOf(url: string): string | null {
  if (!isSqliteUrl(url)) return null;
  // `file:///C:/...` comme `file:C:/...` et `file:\C:\...` : sans les barres de tête d'un lecteur.
  return url
    .slice('file:'.length)
    .replace(/\\/gu, '/')
    .replace(/^\/+(?=[A-Za-z]:)/u, '');
}

/**
 * L'adresse résolue : chemin absolu (barres obliques normales) pour une
 * adresse SQLite relative, depuis `projectDir` ; telle quelle pour un serveur
 * ou un fichier absolu.
 */
export function databaseUrlOf(raw: string | undefined, projectDir: string = process.cwd()): string {
  const url = rawDatabaseUrlOf(raw);
  const file = sqliteFileOf(url);
  if (file === null) return url;
  if (path.isAbsolute(file)) return `file:${file}`;
  return `file:${path.resolve(projectDir, file).split(path.sep).join('/')}`;
}
