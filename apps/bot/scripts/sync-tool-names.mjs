/**
 * Génère packages/shared/src/tools/registry-names.ts : l'union des noms de
 * tools réellement déclarés dans apps/bot/src (source : les `name: '...'`
 * des définitions BotTool). Lancé par `pnpm verify` : un tool ajouté/renommé
 * sans re-générer ce fichier fait échouer la vérification (git diff non vide),
 * et un SkillBlueprint référençant un tool inexistant casse typecheck.
 *
 * Usage : node scripts/sync-tool-names.mjs [--check]
 *   --check : génère en mémoire et sort 1 si le fichier commité diverge.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const BOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(BOT_DIR, '../..');
const SHARED_NAMES = resolve(ROOT, 'packages/shared/src/tools/registry-names.ts');

// name: 'xxx' avec la forme d'un tool (lettres/chiffres/points).
// Fichier exclu : records/collections.ts déclare des COLLECTIONS (reminders,
// quotes...), pas des tools.
const NAME_RE = /name:\s*'([a-zA-Z0-9_.]+)'/gu;
const EXCLUDE_FILES = ['apps/bot/src/modules/records/collections.ts'];
const EXCLUDE = new Set(['agent-request']);

const gitLs = execSync('git ls-files "apps/bot/src/**/*.ts"', { cwd: ROOT, encoding: 'utf8' });
const files = gitLs.split('\n').map((f) => f.trim()).filter((f) => f.endsWith('.ts') && !EXCLUDE_FILES.includes(f));

const names = new Set();
for (const rel of files) {
  const content = readFileSync(resolve(ROOT, rel), 'utf8');
  for (const match of content.matchAll(NAME_RE)) {
    const name = match[1];
    // Un nom de tool contient un point (namespace) OU est camelCase connu ;
    // on garde tout sauf les exclus explicites (sur-validation dans check).
    if (!EXCLUDE.has(name)) names.add(name);
  }
}

const sorted = [...names].sort();
const banner = `// AUTO-GÉNÉRÉ par apps/bot/scripts/sync-tool-names.mjs : NE PAS ÉDITER À LA MAIN.
// Lance \`node scripts/sync-tool-names.mjs\` après avoir ajouté/renommé un tool.
// Typage des SkillBlueprint.requiredTools : un skill référençant un tool
// inexistant casse \`pnpm typecheck\`.
`;
const body = `${banner}
export const REGISTERED_TOOL_NAMES = [
${sorted.map((name) => `  '${name}',`).join('\n')}
] as const;

export type RegisteredToolName = (typeof REGISTERED_TOOL_NAMES)[number];
`;

if (process.argv.includes('--check')) {
  // Un checkout peut rendre CRLF (`core.autocrlf`) : seules les lignes comptent,
  // sinon le contrôle est rouge sur tout checkout frais sous Windows.
  const current = existsSync(SHARED_NAMES) ? readFileSync(SHARED_NAMES, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== body) {
    console.error(`[sync-tool-names] registry-names.ts est périmé (${sorted.length} tools détectés). Lance : node scripts/sync-tool-names.mjs`);
    process.exit(1);
  }
  console.log(`[sync-tool-names] OK (${sorted.length} tools).`);
  process.exit(0);
}

writeFileSync(SHARED_NAMES, body, 'utf8');
console.log(`[sync-tool-names] ${sorted.length} tools écrits dans packages/shared/src/tools/registry-names.ts`);
