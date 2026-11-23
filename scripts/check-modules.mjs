#!/usr/bin/env node
/**
 * Vérifie la cohérence structurelle du bot :
 * - chaque dossier de `src/modules/` doit être importé dans `app.module.ts`
 *   (allowlist pour les dossiers non-modulaires) ;
 * - chaque module enregistré dans le catalogue doit correspondre à un module chargé.
 * Exécuté en CI avant lint/typecheck/test.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/u, '');
const modulesDir = join(root, 'apps', 'bot', 'src', 'modules');
const appModulePath = join(root, 'apps', 'bot', 'src', 'app.module.ts');
const catalogPath = join(root, 'apps', 'bot', 'src', 'modules', 'module-manager', 'module.catalog.ts');

// Dossiers sans fichier <name>.module.ts (helpers / contrôleurs App-level).
const NON_MODULE_DIRS = new Set(['api']);

const appModule = readFileSync(appModulePath, 'utf8');
const catalog = readFileSync(catalogPath, 'utf8');
const importsPattern = new RegExp('imports:\\s*\\[', 'u');
const commandsPattern = new RegExp('commands:\\s*\\[', 'u');

const errors = [];
// Les dossiers cachés ne sont pas des modules (ex. .mimosa, état local d'un hook).
const dirs = readdirSync(modulesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));

for (const dir of dirs) {
  const name = dir.name;
  const moduleFile = join(modulesDir, name, `${name}.module.ts`);
  const isModule = existsSync(moduleFile);

  if (isModule && !NON_MODULE_DIRS.has(name) && !importsPattern.test(appModule)) {
    errors.push(`Module "${name}" has ${name}.module.ts but is not imported in app.module.ts imports[].`);
  }

  if (isModule && !NON_MODULE_DIRS.has(name)) {
    const source = readFileSync(moduleFile, 'utf8');
    const hasCommands = commandsPattern.test(source);
    if (hasCommands) {
      // Les modules à commandes doivent être togglables via le catalogue,
      // sauf les commandes système (allowlist).
      const SYSTEM = new Set(['setup', 'info', 'locale', 'audit', 'guild-config', 'module-manager', 'agent']);
      if (!SYSTEM.has(name) && !catalog.includes(`id: '${name}'`)) {
        errors.push(`Module "${name}" exposes commands but is not registered in module.catalog.ts.`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error('✖ Module consistency check failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`✔ Module consistency OK (${dirs.length} module folders checked).`);
