import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'prisma/config';
import { databaseUrlOf } from './src/modules/database/database-url.ts';

/*
 * CONFIGURATION DE LA CLI PRISMA (generate, migrate, db execute). Prisma 7 ne
 * lit plus l'adresse de la base dans le schéma : il la lit ici, et il ne
 * charge plus les fichiers d'environnement tout seul.
 *
 * L'adresse vient donc de, dans l'ordre : l'environnement de la commande
 * (ce qui permet de viser une autre base, une copie par exemple), puis
 * `.env.local`, puis `.env`, ceux que lit le bot ; à défaut, le défaut du
 * projet. La règle de résolution est celle du client au démarrage
 * (database-url.ts), la même pour la CLI et pour le bot.
 *
 * `prisma.config.ts` est hors `src` : hors typage strict du bot, hors audit
 * d'architecture, et listé dans eslint.ts.config.mjs.
 */

/** La valeur d'une variable dans le premier fichier d'environnement qui la définit. */
function envFileValue(name: string): string | undefined {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(\\S.*)$`, 'mu');
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, 'utf8').match(pattern);
    if (match?.[1] !== undefined) return match[1].trim().replace(/^(["'])(.*)\1$/u, '$2');
  }
  return undefined;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrlOf(process.env.DATABASE_URL ?? envFileValue('DATABASE_URL')),
  },
});
