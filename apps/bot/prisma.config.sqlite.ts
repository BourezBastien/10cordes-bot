import { defineConfig } from 'prisma/config';
import { databaseUrlOf } from './src/modules/database/database-url.ts';
import { loadEnvFiles } from './src/env-files.ts';

/*
 * CONFIGURATION DE LA CLI PRISMA POUR SQLITE : l'ancienne base, lue le temps
 * de sa migration vers PostgreSQL (prisma.config.ts). Mêmes règles : les
 * fichiers d'environnement sont chargés par le bot (env-files.ts), l'adresse
 * se résout comme au démarrage (database-url.ts), et DATABASE_URL donné à la
 * commande désigne une autre base.
 *
 * - schéma : prisma/schema.sqlite.prisma, DÉRIVÉ de prisma/schema.prisma par
 *   scripts/build-sqlite-schema.mjs (jamais édité à la main) ;
 * - migrations : prisma/migrations-sqlite, l'historique figé des 35 migrations
 *   de la base SQLite. On n'y ajoute rien : la cible est PostgreSQL.
 *
 * `node scripts/prisma-cli.mjs <commande>` choisit cette configuration quand
 * DATABASE_URL désigne un fichier.
 */
loadEnvFiles();

export default defineConfig({
  schema: 'prisma/schema.sqlite.prisma',
  migrations: {
    path: 'prisma/migrations-sqlite',
  },
  datasource: {
    url: databaseUrlOf(process.env.DATABASE_URL),
  },
});
