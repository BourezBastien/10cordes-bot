/*
 * MOTEUR DE LA BASE, lu à l'adresse. Deux moteurs sont servis pendant la
 * migration des bases : PostgreSQL 16, la cible, et SQLite, l'ancienne base
 * (prisma/schema.sqlite.prisma en est le schéma dérivé). Un client Prisma
 * généré ne parle qu'à un moteur : la fabrique (database-client.ts) en construit
 * un par moteur et choisit ici, l'adapter, la classe du client, le dialecte du
 * SQL écrit à la main et la configuration de la CLI.
 *
 * Règle unique, partagée par tous : une adresse refusée l'est avec sa forme
 * attendue, jamais avec sa valeur (elle peut porter un mot de passe).
 */

export type DatabaseProvider = 'sqlite' | 'postgresql';

/** `file:` (un fichier SQLite) ou `postgresql://` / `postgres://` (un serveur). */
const POSTGRES_SCHEME = /^postgres(?:ql)?:\/\//u;

/** Vrai pour une adresse SQLite (un fichier), faux pour tout serveur. C'est une forme, pas une validation. */
export function isSqliteUrl(url: string): boolean {
  return url.startsWith('file:');
}

/** Le moteur d'une adresse ; la chaîne vide est le défaut du projet (SQLite local). */
export function databaseProviderOf(raw: string | undefined): DatabaseProvider {
  const url = raw?.trim() ?? '';
  if (url.length === 0 || isSqliteUrl(url)) return 'sqlite';
  if (POSTGRES_SCHEME.test(url)) return 'postgresql';
  throw new Error('DATABASE_URL n\u0027est pas une adresse de base reconnue : attendu file:<chemin> (SQLite) ou postgresql://<serveur> (PostgreSQL).');
}
