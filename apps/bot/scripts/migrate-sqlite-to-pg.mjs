#!/usr/bin/env node
/**
 * MIGRE UNE BASE SQLITE DU BOT VERS POSTGRESQL. Copie les lignes des tables
 * que les deux bases partagent (celles des modèles du schéma), par lots, les
 * tables référencées d'abord ; puis relit la source et la cible et compare
 * chaque ligne, colonne par colonne. Les secrets chiffrés (AES-256-GCM) sont
 * copiés tels quels et comparés octet pour octet : la migration ne les
 * déchiffre jamais et n'affiche jamais aucune valeur.
 *
 * Usage : node scripts/migrate-sqlite-to-pg.mjs [options]
 *   --source <file:...>     la base SQLite à copier ; sinon DATABASE_URL s'il
 *                          désigne un fichier ; sinon la commande est refusée
 *   --target <postgresql://...>  la base PostgreSQL cible ; sinon TARGET_DATABASE_URL
 *   --dry-run               lit et contrôle toute la source, n'écrit rien, ne
 *                          touche pas au schéma de la cible
 *   --skip-schema          n'applique pas les migrations à la cible
 *
 * La cible reçoit d'abord ses migrations (prisma migrate deploy, la
 * configuration du moteur par scripts/prisma-cli.mjs). La migration est
 * idempotente : une ligne dont la clé existe déjà n'est pas reprise, on peut
 * donc relancer après une interruption. Elle ne corrige jamais la cible, et la
 * source n'est jamais écrite.
 *
 * Arrête le bot qui écrit dans la source avant de migrer : une ligne écrite
 * pendant la migration est détectée par la vérification finale, et la
 * migration s'arrête en le disant.
 *
 * Les fichiers d'environnement sont chargés par la règle du bot (.env.local,
 * puis .env) ; l'environnement du processus passe devant. Rien n'affiche
 * jamais le mot de passe de la cible.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from '../src/modules/database/database-client.ts';
import { databaseProviderOf } from '../src/modules/database/database-provider.ts';
import { databaseUrlOf, sqliteFileOf } from '../src/modules/database/database-url.ts';
import { loadEnvFiles } from '../src/env-files.ts';
import { parsePrismaSchema } from '../src/modules/database/migration/schema-catalog.ts';
import { readerOf, sqliteTablesOf, targetOf } from '../src/modules/database/migration/migration-ports.ts';
import { SqliteToPostgresMigrator } from '../src/modules/database/migration/sqlite-to-postgres.migrator.ts';

const BOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const usage = () => {
  console.error('usage : node scripts/migrate-sqlite-to-pg.mjs --source <file:...> --target <postgresql://...> [--dry-run] [--skip-schema]');
  process.exit(2);
};

/** L'option demandée, ou undefined. */
const optionOf = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

/** L'adresse de la cible sans son mot de passe, pour l'afficher. */
const displayOf = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return '(adresse illisible)';
  }
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const skipSchema = process.argv.includes('--skip-schema');
  loadEnvFiles(BOT_DIR);

  const givenSource = optionOf('--source') ?? process.env.SQLITE_SOURCE_URL ?? process.env.DATABASE_URL;
  if (databaseProviderOf(givenSource) !== 'sqlite') {
    throw new Error('Source inconnue : donne la base SQLite à copier (--source file:<chemin>), ou règle DATABASE_URL sur un fichier.');
  }
  const sourceUrl = databaseUrlOf(givenSource);
  const sourceFile = sqliteFileOf(sourceUrl);
  if (sourceFile === null || !existsSync(sourceFile)) throw new Error(`La base SQLite source n'existe pas : ${sourceFile ?? sourceUrl}`);

  const givenTarget = optionOf('--target') ?? process.env.TARGET_DATABASE_URL;
  if (databaseProviderOf(givenTarget) !== 'postgresql') {
    throw new Error('Cible inconnue : donne l\u0027adresse PostgreSQL à remplir (--target postgresql://...), ou règle TARGET_DATABASE_URL.');
  }
  const targetUrl = databaseUrlOf(givenTarget);

  const models = parsePrismaSchema(readFileSync(join(BOT_DIR, 'prisma/schema.sqlite.prisma'), 'utf8'));
  const sizeMb = (statSync(sourceFile).size / 1_048_576).toFixed(1);
  console.log('Migration SQLite vers PostgreSQL');
  console.log(`  source : ${sourceUrl} (${sizeMb} Mo)`);
  console.log(`  cible  : ${displayOf(targetUrl)}${dryRun ? ' (aucune écriture : essai à sec)' : ''}`);

  if (!dryRun && !skipSchema) {
    console.log('  [1/3] migrations de la cible (prisma migrate deploy)');
    const applied = spawnSync(process.execPath, [join(BOT_DIR, 'scripts/prisma-cli.mjs'), 'migrate', 'deploy'], {
      cwd: BOT_DIR,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: targetUrl },
    });
    if (applied.status !== 0) throw new Error(`Les migrations de la cible ont échoué (code ${applied.status ?? 1}). Rien n'a été copié.`);
  }

  const source = createDatabaseClient(sourceUrl);
  try {
    await source.$connect();
    const report = await new SqliteToPostgresMigrator(readerOf(source), targetOf(createDatabaseClient(targetUrl)), models).run({
      sourceTables: await sqliteTablesOf(source),
      dryRun,
      onProgress: (line) => console.log(`  ${dryRun ? '[essai]' : '[2/3]'} ${line}`),
    });
    console.log(dryRun ? 'Essai à sec terminé : rien n\u0027a été écrit.' : 'Migration terminée.');
    const notCopied = report.skippedTables.length > 0 ? ` (${report.skippedTables.join(', ')})` : '';
    console.log(`  tables   : ${report.controlledTables} contrôlée(s), ${report.controlledTables} vérifiée(s) ligne à ligne, ${report.skippedTables.length} non copiée(s)${notCopied}`);
    if (report.absentTables.length > 0) console.log(`  absentes de la source : ${report.absentTables.join(', ')}`);
    console.log(`  lignes   : ${report.totalRows} lue(s), ${report.totalInserted} écrite(s)`);
    console.log(`  secrets  : ${report.secretRows} ligne(s) chiffrée(s) comparée(s)`);
    if (!dryRun && report.totalInserted === 0) console.log('  Rien de nouveau à copier : la cible contenait déjà toutes les lignes de la source.');
  } finally {
    await source.$disconnect();
  }
}

main().catch((error) => {
  // Le message d'une erreur de la migration nomme une table, une colonne, un compte : jamais une valeur.
  console.error(`Migration refusée : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
