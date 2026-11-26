#!/usr/bin/env node
/**
 * Lance une commande de la CLI Prisma avec la configuration du MOTEUR de
 * DATABASE_URL : prisma.config.ts pour PostgreSQL (la cible),
 * prisma.config.sqlite.ts pour SQLite (l'ancienne base). Les schémas, les
 * clients générés et les historiques de migrations sont distincts, et la CLI
 * n'en lit qu'un par commande.
 *
 * Usage : node scripts/prisma-cli.mjs <commande> [options]
 *   node scripts/prisma-cli.mjs migrate deploy    (pnpm db:deploy)
 *   node scripts/prisma-cli.mjs migrate status    (pnpm db:status)
 *
 * Les fichiers d'environnement sont chargés par la règle du bot (.env.local,
 * puis .env) ; l'environnement du processus passe devant. Une adresse
 * refusée l'est par la règle du projet (database-provider.ts), sans sa valeur.
 * L'image Docker lance ce script au démarrage, avant le bot.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseProviderOf } from '../src/modules/database/database-provider.ts';
import { loadEnvFiles } from '../src/env-files.ts';

const BOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const CONFIGS = {
  postgresql: 'prisma.config.ts',
  sqlite: 'prisma.config.sqlite.ts',
};

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage : node scripts/prisma-cli.mjs <commande Prisma> [options]');
  process.exit(2);
}

loadEnvFiles(BOT_DIR);
const provider = databaseProviderOf(process.env.DATABASE_URL);
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

const result = spawnSync(process.execPath, [prismaCli, ...args, '--config', CONFIGS[provider]], {
  cwd: BOT_DIR,
  stdio: 'inherit',
});
if (result.error) console.error(`La CLI Prisma n\u0027a pas pu être lancée : ${result.error.message}`);
process.exit(result.status ?? 1);
