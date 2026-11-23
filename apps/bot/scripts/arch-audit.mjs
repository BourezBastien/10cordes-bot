#!/usr/bin/env node
/**
 * scripts/arch-audit.mjs (A6) : audit architectural statique POO.
 * Détecte : UI dans Service, permissions dispersées, God Classes, any,
 * process.env hors config/, cycle de vie dans une classe de module.
 *
 * Usage :
 *   node scripts/arch-audit.mjs                         rapport STRICT, exit 1 si une seule violation
 *   node scripts/arch-audit.mjs --baseline <fichier>    CLIQUET : exit 1 seulement sur une violation
 *                                                       absente de la baseline (dette acceptée)
 *   node scripts/arch-audit.mjs --write-baseline <fic>  écrit la baseline à partir de l'état actuel
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const BOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = resolve(BOT_DIR, '../..');

const violations = [];
const warn = (file, line, rule, detail) => {
  violations.push({ file: relative(ROOT, file), line, rule, detail });
};

// ── Helpers ──
function walkTs(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.spraxium' || entry === 'dist' || entry === '.mimosa') continue;
      files.push(...walkTs(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function countLines(text) {
  return text.split('\n').length;
}

// ── Règles ──
const UI_IMPORTS = /import\s+.*(?:ContainerBuilder|ButtonBuilder|ModalBuilder|EmbedBuilder|ActionRowBuilder|SectionBuilder|TextDisplayBuilder|SeparatorBuilder|MediaGalleryBuilder)/;
const UI_FLAGS = /MessageFlags\.IsComponentsV2/;
const PERMISSION_CHECK = /PermissionFlagsBits\.|guild\.ownerId\s*===?/;
const ANY_CAST = /:\s*any\b|as\s+any\b/;
const PROCESS_ENV = /process\.env\./;

function auditFile(file) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const rel = relative(ROOT, file);
  const isService = /\.service\.ts$/.test(file);
  // Séparateurs [\\/] : sous Windows les chemins arrivent avec des backslashes.
  const isConfig = /[\\/]config[\\/]/.test(file) || file.endsWith('app.env.ts') || file.endsWith('http.config.ts') || file.endsWith('development.config.ts') || file.endsWith('components.config.ts');
  const isSecurity = /[\\/]core[\\/]security[\\/]/.test(file);
  const isTest = /\.spec\.ts$/.test(file) || /\.test\.ts$/.test(file) || /[\\/]tests?[\\/]/.test(file);

  // Règle 1 : UI dans Service (les Presenters/Renderers/Handlers ont le droit)
  if (isService && !isTest) {
    for (let i = 0; i < lines.length; i++) {
      if (UI_IMPORTS.test(lines[i])) {
        warn(file, i + 1, 'UI_IN_SERVICE', `Import de builder Discord UI dans un service — extraire un Presenter`);
      }
      if (UI_FLAGS.test(lines[i])) {
        warn(file, i + 1, 'UI_IN_SERVICE', `MessageFlags.IsComponentsV2 dans un service — déléguer au Presenter`);
      }
    }
  }

  // Règle 2 : permissions dispersées (uniquement dans core/security/)
  if (!isSecurity && !isTest && !isConfig) {
    for (let i = 0; i < lines.length; i++) {
      if (PERMISSION_CHECK.test(lines[i]) && !lines[i].includes('// arch:allow')) {
        warn(file, i + 1, 'PERMISSION_DISPERSED', `Check de permission hors core/security/ — utiliser une Policy`);
      }
    }
  }

  // Règle 3 : God Classes (> 300 lignes par fichier)
  if (!isTest && countLines(text) > 300) {
    warn(file, 0, 'GOD_CLASS', `${countLines(text)} lignes (seuil 300) — scinder`);
  }

  // Règle 4 : any
  for (let i = 0; i < lines.length; i++) {
    if (ANY_CAST.test(lines[i]) && !isTest) {
      warn(file, i + 1, 'ANY_TYPE', `Type any détecté — typer proprement`);
    }
  }

  // Règle 5 : process.env hors config/
  if (!isConfig && !isTest) {
    for (let i = 0; i < lines.length; i++) {
      if (PROCESS_ENV.test(lines[i]) && !lines[i].includes('// arch:allow')) {
        warn(file, i + 1, 'PROCESS_ENV', `process.env hors config/ — utiliser AppEnv`);
      }
    }
  }

  // Règle 6 : cycle de vie dans une classe de MODULE. Le framework ne crée
  // jamais d'instance de module (seuls providers/listeners/handlers sont
  // enregistrés) : un onBoot/onReady/onShutdown ou un constructor de module
  // ne s'exécute JAMAIS. Trois modules portaient ainsi du code mort, dont la
  // liaison des règles de confirmation destructive.
  if (/\.module\.ts$/.test(file)) {
    // Commentaires vidés (sans décaler les lignes) : un commentaire qui
    // MENTIONNE un onBoot n'est pas du code mort.
    const codeOnly = text
      .replace(/\/\*[\s\S]*?\*\//gu, (block) => block.replace(/[^\n]/gu, ''))
      .replace(/^[ \t]*\/\/.*$/gmu, (line) => line.replace(/[^\n]/gu, ''));
    const lifecycle = codeOnly.match(/\b(?:onBoot|onReady|onShutdown)\s*\(|\bconstructor\s*\(/u);
    if (lifecycle) {
      const line = codeOnly.slice(0, lifecycle.index).split('\n').length;
      warn(file, line, 'LIFECYCLE_ON_MODULE', `Cycle de vie dans une classe de module : jamais exécuté par le framework, lier dans un provider`);
    }
  }
}

// ── Exécution ──
const botSrc = resolve(BOT_DIR, 'src');
const sharedSrc = resolve(ROOT, 'packages/shared/src');
const allFiles = [...walkTs(botSrc), ...walkTs(sharedSrc)];

for (const file of allFiles) {
  auditFile(file);
}

// ── Rapport ──
const RULE_LABELS = {
  UI_IN_SERVICE: 'UI dans Service (extraire un Presenter)',
  PERMISSION_DISPERSED: 'Permissions dispersées (utiliser une Policy)',
  GOD_CLASS: 'God Class > 300 lignes',
  ANY_TYPE: 'Type any',
  PROCESS_ENV: 'process.env hors config/',
  LIFECYCLE_ON_MODULE: 'Cycle de vie dans une classe de module (jamais exécuté)',
};

// Règles qui ne peuvent JAMAIS entrer dans une baseline : elles marquent du
// code qui ne s'exécute pas ou une régression connue pour avoir coûté cher.
const HARD_ZERO_RULES = new Set(['LIFECYCLE_ON_MODULE']);

console.log(`\n=== ARCH AUDIT · ${allFiles.length} fichiers analysés ===\n`);

function printViolations(items, { limit = 10 } = {}) {
  const byRule = new Map();
  for (const v of items) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    byRule.get(v.rule).push(v);
  }
  for (const [rule, ruleItems] of byRule) {
    console.log(`\n🔴 ${RULE_LABELS[rule] ?? rule} : ${ruleItems.length}`);
    for (const item of ruleItems.slice(0, limit)) {
      console.log(`  ${item.file}:${item.line} : ${item.detail}`);
    }
    if (ruleItems.length > limit) console.log(`  ... et ${ruleItems.length - limit} autre(s)`);
  }
}

/** Clé stable d'une violation : règle + fichier (chemin à barres obliques), sans numéro de ligne. */
function violationKey(violation) {
  return `${violation.rule}:${violation.file.replace(/\\/gu, '/')}`;
}

function countByRule(items) {
  const counts = new Map();
  for (const v of items) {
    const key = violationKey(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function flagValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const baselinePath = flagValue('--baseline');
const writeBaselinePath = flagValue('--write-baseline');

// ── Écriture de la baseline (dette acceptée, à régénérer quand elle baisse) ──
if (writeBaselinePath) {
  const counts = Object.fromEntries([...countByRule(violations)].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(resolve(ROOT, writeBaselinePath), `${JSON.stringify(counts, null, 2)}\n`, 'utf8');
  console.log(`Baseline écrite : ${violations.length} violation(s) acceptée(s) dans ${writeBaselinePath} (${Object.keys(counts).length} couples règle/fichier).\n`);
  process.exit(0);
}

if (violations.length === 0) {
  console.log('✅ Zéro violation POO détectée.\n');
  process.exit(0);
}

// ── Mode cliquet : seules les violations ABSENTES de la baseline font échouer ──
if (baselinePath) {
  let baseline = {};
  try {
    baseline = JSON.parse(readFileSync(resolve(ROOT, baselinePath), 'utf8'));
  } catch (error) {
    console.error(`Baseline illisible (${baselinePath}) : ${error.message}. Régénère-la avec --write-baseline.`);
    process.exit(1);
  }
  // Ordinale de chaque violation dans son couple règle/fichier : les `allowed`
  // premières sont couvertes par la baseline, les suivantes sont nouvelles.
  const seen = new Map();
  const fresh = [];
  for (const v of violations) {
    const key = violationKey(v);
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    const allowed = HARD_ZERO_RULES.has(v.rule) ? 0 : (baseline[key] ?? 0);
    if (ordinal >= allowed) fresh.push(v);
  }
  const accepted = violations.length - fresh.length;
  if (fresh.length > 0) {
    console.log(`❌ ${fresh.length} NOUVELLE(S) violation(s) par rapport à la baseline :\n`);
    printViolations(fresh, { limit: 15 });
    console.log(`\nDette acceptée par la baseline : ${accepted} violation(s). Corrige les nouvelles, ou assume-les explicitement via --write-baseline.\n`);
    process.exit(1);
  }
  const actual = countByRule(violations);
  const repaid = Object.entries(baseline).reduce((sum, [key, allowed]) => sum + Math.max(0, allowed - (actual.get(key) ?? 0)), 0);
  console.log(`✅ Aucune nouvelle violation POO. Dette acceptée par la baseline : ${violations.length} violation(s) sur ${Object.keys(baseline).length} couples règle/fichier.`);
  if (repaid > 0) console.log(`ℹ️  ${repaid} violation(s) remboursée(s) depuis la baseline : régénère-la (--write-baseline) pour baisser le plafond.`);
  console.log('');
  process.exit(0);
}

// ── Mode strict : tout relevé fait échouer ──
printViolations(violations);
console.log(`\n⚠️  TOTAL : ${violations.length} violation(s). Corrige pour un rapport propre.\n`);
process.exit(1);
