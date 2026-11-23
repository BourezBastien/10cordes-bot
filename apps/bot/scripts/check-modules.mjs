/**
 * Contrôles de cohérence de la codebase (pnpm check:modules) :
 * 1. Chaque dossier modules/<x> contenant un @Module est importé dans AppModule.
 * 2. Les tools togglables du catalogue existent bien en code.
 * 3. registry-names.ts (union RegisteredToolName) est synchronisé avec les
 *    tools réellement déclarés (sinon : node scripts/sync-tool-names.mjs).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const BOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = resolve(BOT_DIR, 'src');
let failures = 0;
const fail = (msg) => {
  console.error(`[check-modules] FAIL ${msg}`);
  failures += 1;
};

// 1. Modules présents sur disque vs AppModule.
const appModule = readFileSync(resolve(SRC, 'app.module.ts'), 'utf8');
const modulesDir = resolve(SRC, 'modules');
for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const moduleFile = readdirSync(resolve(modulesDir, entry.name)).find((f) => f.endsWith('.module.ts'));
  if (!moduleFile) continue;
  const moduleName = moduleFile.replace('.module.ts', '');
  const pascal = moduleName
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  // Insensible à la casse (WebToolsModule vs WebtoolsModule).
  const needle = `${pascal}Module`.toLowerCase();
  const importedNames = [...appModule.matchAll(/import\s*\{([^}]+)\}/gu)].flatMap((m) => m[1].split(',').map((n) => n.trim().toLowerCase()));
  if (!importedNames.includes(needle)) {
    fail(`modules/${entry.name} expose ${pascal}Module mais AppModule ne l'importe pas.`);
  }
}

// 2. Chaque id du catalogue correspond à un dossier module réel.
const catalogPath = resolve(SRC, 'modules/module-manager/module.catalog.ts');
if (existsSync(catalogPath)) {
  const catalog = readFileSync(catalogPath, 'utf8');
  for (const id of catalog.matchAll(/id: '([a-z-]+)'/gu)) {
    if (!existsSync(resolve(modulesDir, id[1]))) {
      fail(`le catalogue référence le module "${id[1]}" sans dossier modules/${id[1]}.`);
    }
  }
}

// 3. Union RegisteredToolName synchronisée avec les tools déclarés.
try {
  execFileSync(process.execPath, [resolve(BOT_DIR, 'scripts/sync-tool-names.mjs'), '--check'], {
    cwd: BOT_DIR,
    stdio: 'inherit',
  });
} catch {
  failures += 1;
}

if (failures > 0) {
  console.error(`[check-modules] ${failures} contrôle(s) en échec.`);
  process.exit(1);
}
console.log('[check-modules] OK : modules câblés, catalogue cohérent, tool names synchronisés.');
