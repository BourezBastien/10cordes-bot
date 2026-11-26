/**
 * Dérive prisma/schema.sqlite.prisma de prisma/schema.prisma. Le schéma
 * PostgreSQL est l'unique source de vérité ; le schéma SQLite n'existe que
 * pour que le bot continue de lire une base SQLite pendant sa migration vers
 * PostgreSQL (même schéma, un client Prisma généré par moteur).
 *
 * Ce qui change d'un moteur à l'autre, et rien d'autre :
 * - le fournisseur de la source de données ;
 * - le dossier du client généré ;
 * - le type natif `@db.Timestamptz(3)`, que SQLite ne connaît pas (il garde
 *   ses dates en entiers, voir database-client.ts) ;
 * - l'en-tête, qui dit la place de chaque schéma.
 *
 * Usage : node scripts/build-sqlite-schema.mjs [--check]
 *   --check : dérive en mémoire et sort 1 si le fichier commité diverge
 *             (`pnpm verify`).
 *
 * Chaque repère est contrôlé : si le schéma PostgreSQL change de forme, le
 * script s'arrête en nommant ce qu'il ne trouve plus, il ne dérive rien.
 * Le dérivé s'écrit avec des fins de ligne LF et n'est jamais reformaté à la
 * main : le contrôle compare le texte exact, les fins de ligne mises à part.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE = resolve(BOT_DIR, 'prisma/schema.prisma');
const TARGET = resolve(BOT_DIR, 'prisma/schema.sqlite.prisma');

const BANNER = [
  '// FICHIER GÉNÉRÉ par scripts/build-sqlite-schema.mjs, depuis prisma/schema.prisma.',
  '// Ne pas l\'éditer : modifier le schéma PostgreSQL, puis lancer',
  '// `pnpm --filter 10cordes-bot db:schema:sqlite`. `pnpm verify` refuse un dérivé qui diverge.',
  '//',
  '',
].join('\n');

/** Le paragraphe d'en-tête qui décrit la cible PostgreSQL, et ce qu'il dit en SQLite. */
const POSTGRES_HEADER = /^\/\/ PostgreSQL 16 est LA cible[^\n]*\n(?:^\/\/[^\n]*\n)*/mu;
const SQLITE_HEADER = [
  '// SQLite n\'est plus la cible (PostgreSQL, le 26/11/2026) : il reste lu le temps de la',
  '// migration des bases. Ses dates sont des entiers, en millisecondes : le format que',
  '// l\'adaptateur libsql garde (database-client.ts).',
  '',
].join('\n');

/** Les substitutions, chacune avec le nom de son repère. */
const REWRITINGS = [
  [POSTGRES_HEADER, SQLITE_HEADER, 'le paragraphe d\'en-tête propre à PostgreSQL'],
  [/^datasource db \{\n  provider = "postgresql"\n\}/mu, 'datasource db {\n  provider = "sqlite"\n}', 'la source de données'],
  [/^  output(\s+)= "\.\.\/generated\/prisma"$/mu, '  output$1= "../generated/prisma-sqlite"', 'le dossier du client généré'],
  [/^\/\/ apps\/bot\/generated\/prisma, hors src /mu, '// apps/bot/generated/prisma-sqlite, hors src ', 'le dossier du client dans le commentaire d\'en-tête'],
];

/** Fins de ligne ramenées à LF, dans les deux sens. */
const toLf = (text) => text.split('\r\n').join('\n');

/** Le schéma PostgreSQL, réécrit pour SQLite. Lève si un repère a disparu. */
export function deriveSqliteSchema(postgres) {
  let text = toLf(postgres);
  for (const [pattern, replacement, what] of REWRITINGS) {
    if (!pattern.test(text)) throw new Error(`prisma/schema.prisma a changé de forme : ${what} est introuvable.`);
    text = text.replace(pattern, replacement);
  }
  return `${BANNER}${text.replaceAll(' @db.Timestamptz(3)', '')}`.replace(/\n+$/u, '\n');
}

const expected = deriveSqliteSchema(readFileSync(SOURCE, 'utf8'));

if (process.argv.includes('--check')) {
  const committed = toLf(readFileSync(TARGET, 'utf8'));
  if (committed !== expected) {
    console.error('prisma/schema.sqlite.prisma diverge de prisma/schema.prisma.');
    console.error('Relance : pnpm --filter 10cordes-bot db:schema:sqlite');
    process.exit(1);
  }
  console.log('prisma/schema.sqlite.prisma est à jour.');
} else {
  writeFileSync(TARGET, expected);
  console.log('prisma/schema.sqlite.prisma dérivé de prisma/schema.prisma.');
}
