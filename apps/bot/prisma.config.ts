import { defineConfig } from 'prisma/config';
import { databaseUrlOf } from './src/modules/database/database-url.ts';
import { loadEnvFiles } from './src/env-files.ts';

/*
 * CONFIGURATION DE LA CLI PRISMA (generate, migrate, db execute). Prisma 7 ne
 * lit plus l'adresse de la base dans le schéma : il la lit ici, et il ne
 * charge plus les fichiers d'environnement tout seul.
 *
 * Les fichiers sont chargés par la règle du bot (env-files.ts), depuis le
 * dossier d'où la commande passe : l'environnement du processus d'abord, puis
 * `.env.local`, puis `.env`. Ce qui permet de viser une autre base (une copie
 * par exemple) en donnant DATABASE_URL à la commande. Sans rien : le défaut du
 * projet. L'adresse se résout comme au démarrage du bot (database-url.ts).
 *
 * `prisma.config.ts` est hors `src` : hors typage strict du bot, hors audit
 * d'architecture, et listé dans eslint.ts.config.mjs. L'image Docker emporte
 * ce fichier et les deux modules qu'il importe.
 */
loadEnvFiles();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrlOf(process.env.DATABASE_URL),
  },
});
