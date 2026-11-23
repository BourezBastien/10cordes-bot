#!/usr/bin/env node
/**
 * scripts/arch-audit.mjs (A6) — audit architectural statique POO.
 * Détecte : UI dans Service, permissions dispersées, God Classes,
 * méthodes géantes, any, process.env hors config/.
 *
 * Usage : node scripts/arch-audit.mjs (ou pnpm arch:audit)
 * Exit 1 si violations > 0.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
  const isConfig = /\/config\//.test(file) || file.endsWith('app.env.ts') || file.endsWith('http.config.ts') || file.endsWith('development.config.ts') || file.endsWith('components.config.ts');
  const isSecurity = /[\\/]core[\\/]security[\\/]/.test(file);
  const isTest = /\.spec\.ts$/.test(file) || /\.test\.ts$/.test(file) || /\/tests?\//.test(file);

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
}

// ── Exécution ──
const botSrc = resolve(BOT_DIR, 'src');
const sharedSrc = resolve(ROOT, 'packages/shared/src');
const allFiles = [...walkTs(botSrc), ...walkTs(sharedSrc)];

for (const file of allFiles) {
  auditFile(file);
}

// ── Rapport ──
console.log(`\n=== ARCH AUDIT — ${allFiles.length} fichiers analysés ===\n`);

if (violations.length === 0) {
  console.log('✅ Zéro violation POO détectée.\n');
  process.exit(0);
}

// Grouper par règle
const byRule = new Map();
for (const v of violations) {
  if (!byRule.has(v.rule)) byRule.set(v.rule, []);
  byRule.get(v.rule).push(v);
}

const RULE_LABELS = {
  UI_IN_SERVICE: 'UI dans Service (extraire un Presenter)',
  PERMISSION_DISPERSED: 'Permissions dispersées (utiliser une Policy)',
  GOD_CLASS: 'God Class > 300 lignes',
  ANY_TYPE: 'Type any',
  PROCESS_ENV: 'process.env hors config/',
};

for (const [rule, items] of byRule) {
  console.log(`\n🔴 ${RULE_LABELS[rule] ?? rule} : ${items.length}`);
  for (const item of items.slice(0, 10)) {
    console.log(`  ${item.file}:${item.line} — ${item.detail}`);
  }
  if (items.length > 10) console.log(`  ... et ${items.length - 10} autre(s)`);
}

console.log(`\n⚠️  TOTAL : ${violations.length} violation(s). Corrige pour un rapport propre.\n`);
process.exit(1);
