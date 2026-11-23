#!/usr/bin/env node
/**
 * scripts/arch-audit.mjs (A6) : audit architectural statique POO.
 * Détecte : UI dans Service, permissions dispersées, God Classes, any,
 * process.env hors config/, cycle de vie dans une classe de module.
 *
 * Usage : node apps/bot/scripts/arch-audit.mjs
 * Rapport STRICT : exit 1 sur la moindre violation. Il n'y a ni baseline ni
 * cliquet : une règle ne se contourne pas, le code se corrige.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Un `/` ouvre un littéral regex quand il suit un endroit où une expression commence.
const REGEX_OPENER = /(?:[=(,:[!&|?{};]|\breturn|\bcase|\btypeof|=>)\s*$/u;

/**
 * Efface les littéraux regex d'une ligne de code : un `(?:any` dans un motif
 * n'est pas une annotation de type. Sans ça, une regex de détection de
 * silence (« without any reply ») était prise pour un `any`.
 */
function blankRegexLiterals(line) {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '/' && REGEX_OPENER.test(out)) {
      let j = i + 1;
      let inClass = false;
      while (j < line.length) {
        const c = line[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j += 1;
      }
      if (j < line.length) {
        out += ' /re';
        i = j;
        continue;
      }
    }
    out += line[i];
  }
  return out;
}

// ── Règles ──
const UI_IMPORTS = /import\s+.*(?:ContainerBuilder|ButtonBuilder|ModalBuilder|EmbedBuilder|ActionRowBuilder|SectionBuilder|TextDisplayBuilder|SeparatorBuilder|MediaGalleryBuilder)/;
const UI_FLAGS = /MessageFlags\.IsComponentsV2/;
// Permission Discord lue ou comparée hors core/security/ : bitflags,
// propriétaire du serveur, liste de noms (ToolRunContext.permissions),
// permissions d'une interaction, appartenance à un rôle d'un MEMBRE
// (l'existence d'un rôle, via guild.roles.cache, n'est pas une décision d'accès).
const PERMISSION_CHECK =
  /PermissionFlagsBits\.|guild\.ownerId\s*===?|permissions\.toArray\(\)|permissions\.has\(|memberPermissions|permissions\.includes\(|(?<!guild)\.roles\.cache\.has(?:Any)?\(/;
const ANY_CAST = /:\s*any\b|as\s+any\b/;
const PROCESS_ENV = /process\.env\./;

function auditFile(file) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const isService = /\.service\.ts$/.test(file);
  // Séparateurs [\\/] : sous Windows les chemins arrivent avec des backslashes.
  const isConfig = /[\\/]config[\\/]/.test(file) || file.endsWith('app.env.ts') || file.endsWith('http.config.ts') || file.endsWith('development.config.ts') || file.endsWith('components.config.ts');
  const isSecurity = /[\\/]core[\\/]security[\\/]/.test(file);
  const isTest = /\.spec\.ts$/.test(file) || /\.test\.ts$/.test(file) || /[\\/]tests?[\\/]/.test(file);

  // Règle 1 : UI dans Service (les Presenters/Renderers/Handlers ont le droit)
  if (isService && !isTest) {
    for (let i = 0; i < lines.length; i++) {
      if (UI_IMPORTS.test(lines[i])) {
        warn(file, i + 1, 'UI_IN_SERVICE', `Import de builder Discord UI dans un service : extraire un Presenter`);
      }
      if (UI_FLAGS.test(lines[i])) {
        warn(file, i + 1, 'UI_IN_SERVICE', `MessageFlags.IsComponentsV2 dans un service : déléguer au Presenter`);
      }
    }
  }

  // Règle 2 : permissions dispersées (uniquement dans core/security/)
  if (!isSecurity && !isTest && !isConfig) {
    for (let i = 0; i < lines.length; i++) {
      if (PERMISSION_CHECK.test(lines[i]) && !lines[i].includes('// arch:allow')) {
        warn(file, i + 1, 'PERMISSION_DISPERSED', `Check de permission hors core/security/ : utiliser une Policy`);
      }
    }
  }

  // Règle 3 : God Classes (> 300 lignes par fichier)
  if (!isTest && countLines(text) > 300) {
    warn(file, 0, 'GOD_CLASS', `${countLines(text)} lignes (seuil 300) : scinder`);
  }

  // Règle 4 : any
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
    if (!isTest && !isComment && ANY_CAST.test(blankRegexLiterals(lines[i]))) {
      warn(file, i + 1, 'ANY_TYPE', `Type any détecté : typer proprement`);
    }
  }

  // Règle 5 : process.env hors config/
  if (!isConfig && !isTest) {
    for (let i = 0; i < lines.length; i++) {
      if (PROCESS_ENV.test(lines[i]) && !lines[i].includes('// arch:allow')) {
        warn(file, i + 1, 'PROCESS_ENV', `process.env hors config/ : utiliser AppEnv`);
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

console.log(`\n=== ARCH AUDIT · ${allFiles.length} fichiers analysés ===\n`);

if (violations.length === 0) {
  console.log('✅ Zéro violation POO détectée.\n');
  process.exit(0);
}

const byRule = new Map();
for (const v of violations) {
  if (!byRule.has(v.rule)) byRule.set(v.rule, []);
  byRule.get(v.rule).push(v);
}
for (const [rule, ruleItems] of byRule) {
  console.log(`\n🔴 ${RULE_LABELS[rule] ?? rule} : ${ruleItems.length}`);
  for (const item of ruleItems) {
    console.log(`  ${item.file}:${item.line} : ${item.detail}`);
  }
}
console.log(`\n⚠️  TOTAL : ${violations.length} violation(s). Corrige pour un rapport propre.\n`);
process.exit(1);
