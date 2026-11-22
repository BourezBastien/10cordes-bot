import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * diagnose.mjs (R3) : résumé d'audit des logs JSONL du bot — l'outil pour
 * « revérifier à chaque fois en local et identifier les problèmes ».
 * Usage : node scripts/diagnose.mjs [jours]
 */
const BOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const LOGS_DIR = resolve(BOT_DIR, 'logs');

const days = Number.parseInt(process.argv[2] ?? '1', 10);

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function p95(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

// ── Fichiers de la fenêtre ──
const cutoff = Date.now() - days * 86_400_000;
const files = existsSync(LOGS_DIR)
  ? readdirSync(LOGS_DIR).filter((name) => name.startsWith('bot-') && name.endsWith('.jsonl')).sort().slice(-days)
  : [];
const entries = files.flatMap((name) => readJsonl(join(LOGS_DIR, name)));
const llm = readJsonl(join(LOGS_DIR, 'llm.jsonl')).filter((entry) => new Date(entry.ts).getTime() >= cutoff);

console.log(`\n=== DIAGNOSE (${days} j) — ${entries.length} lignes, ${llm.length} appels LLM ===\n`);

// 1. Erreurs par contexte
const errors = entries.filter((entry) => entry.level === 'error');
const byCtx = new Map();
for (const error of errors) {
  const key = `${error.ctx}/${error.event}`;
  byCtx.set(key, (byCtx.get(key) ?? 0) + 1);
}
if (errors.length === 0) console.log('Erreurs : AUCUNE 🎉');
else {
  console.log(`Erreurs : ${errors.length}`);
  for (const [key, count] of [...byCtx.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${count}x ${key}`);
  }
  const last = errors[errors.length - 1];
  console.log(`  dernière : ${last?.ts} ${last?.ctx} ${String(JSON.stringify(last?.data ?? {})).slice(0, 140)}`);
}

// 2. LLM : latence, tokens, échecs
if (llm.length > 0) {
  const durs = llm.map((entry) => entry.ms).filter((ms) => typeof ms === 'number');
  const tokens = llm.reduce((sum, entry) => sum + (entry.promptTokens ?? 0) + (entry.completionTokens ?? 0), 0);
  const fails = llm.filter((entry) => entry.ok === false);
  console.log(`\nLLM : ${llm.length} appels, ${tokens} tokens cumulés, ${fails.length} échec(s)`);
  console.log(`  latence p50 ${durs.sort((a, b) => a - b)[Math.floor(durs.length / 2)] ?? 0} ms · p95 ${p95(durs)} ms`);
  const byCause = new Map();
  for (const entry of llm) byCause.set(entry.cause, (byCause.get(entry.cause) ?? 0) + 1);
  console.log(`  par cause : ${[...byCause.entries()].map(([cause, count]) => `${cause}=${count}`).join(', ')}`);
}

// 3. Tools : les plus lents / plus échoués
const toolRuns = entries.filter((entry) => entry.event === 'tool.run');
if (toolRuns.length > 0) {
  const durations = new Map();
  const failures = new Map();
  for (const run of toolRuns) {
    const name = String(run.data?.tool ?? '?');
    if (typeof run.data?.ms === 'number') {
      const list = durations.get(name) ?? [];
      list.push(run.data.ms);
      durations.set(name, list);
    }
    if (run.data?.ok === false) failures.set(name, (failures.get(name) ?? 0) + 1);
  }
  console.log(`\nTools : ${toolRuns.length} exécutions`);
  const slowest = [...durations.entries()].map(([name, list]) => ({ name, avg: Math.round(list.reduce((a, b) => a + b, 0) / list.length) })).sort((a, b) => b.avg - a.avg).slice(0, 5);
  for (const { name, avg } of slowest) console.log(`  lent : ${name} ~${avg} ms`);
  for (const [name, count] of [...failures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`  échec : ${name} ${count}x`);
}

// 4. Gate : acceptations vs rejets
const gate = entries.filter((entry) => entry.ctx === 'gate');
if (gate.length > 0) {
  const accepted = gate.filter((entry) => entry.event === 'accept').length;
  const rejected = gate.length - accepted;
  console.log(`\nGate : ${gate.length} messages évalués → ${accepted} acceptés, ${rejected} ignorés`);
}

// 5. Triggers
const triggers = entries.filter((entry) => entry.ctx === 'triggers');
if (triggers.length > 0) {
  const run = triggers.filter((entry) => entry.event === 'run').length;
  const caughtUp = triggers.filter((entry) => entry.event === 'run' && entry.data?.catchup === true).length;
  const skipped = triggers.filter((entry) => entry.event === 'skipped').length;
  console.log(`\nTriggers : ${run} exécutions (dont ${caughtUp} rattrapés après reboot), ${skipped} sautés (condition)`);
}

// 6. Confirmations destructives
const confirms = entries.filter((entry) => String(entry.event).startsWith('rule.confirm'));
if (confirms.length > 0) {
  const shown = confirms.filter((entry) => entry.event === 'rule.confirm.shown').length;
  const accepted = confirms.filter((entry) => entry.event === 'rule.confirm.accepted').length;
  const denied = confirms.filter((entry) => entry.event === 'rule.confirm.denied').length;
  console.log(`\nConfirmations : ${shown} demandées → ${accepted} ✅, ${denied} ❌`);
}

console.log('\nFichiers :', files.join(', ') || 'aucun');
