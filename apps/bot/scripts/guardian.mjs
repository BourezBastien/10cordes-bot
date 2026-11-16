/**
 * Guardian 10cordes : santé du bot + relance + sonde interne.
 *
 * Usage : `node scripts/guardian.mjs` (depuis n'importe où, les chemins sont
 * résolus depuis ce fichier). Sortie : lignes CHECK/REPAIR/PROBE puis un
 * VERDICT PASS|FAIL. Code de sortie 0 = sain, 1 = action requise.
 *
 * Étapes :
 *  1. HTTP local : le serveur REST répond sur :3000 (404 inclus = vivant).
 *  2. Sinon : rebuild si dist absent, relance détachée, attente du login.
 *  3. Redis : `docker exec <container> redis-cli ping` (avertissement si KO,
 *     la queue bascule déjà en mémoire toute seule).
 *  4. Audit : erreurs assistant sur les 35 dernières minutes + fraîcheur.
 *  5. Sonde interne GET /healthz (DB, queue, gateway) — aucun message Discord :
 *     la surveillance est silencieuse, les incidents sont notifiés par
 *     HealthMonitor (alerte uniquement sur changement d'état).
 */
import { readFileSync, existsSync, openSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BOT_DIR = resolve(SCRIPT_DIR, '..');
const ROOT_DIR = resolve(BOT_DIR, '..');
const LOG_FILE = resolve(BOT_DIR, 'prod-run.log');
const DIST_ENTRY = resolve(BOT_DIR, '.spraxium/dist/src/main.mjs');

const lines = [];
const say = (tag, msg) => {
  lines.push(`[${tag}] ${msg}`);
  console.log(`[${tag}] ${msg}`);
};

function loadEnv() {
  const env = {};
  for (const file of ['.env.local', '.env']) {
    const p = resolve(BOT_DIR, file);
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

/** Timestamps du log au format `dd/MM/yyyy - HH:mm:ss`. */
function parseLogTime(stamp) {
  const m = stamp.match(/(\d{2})\/(\d{2})\/(\d{4}) - (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
}

function tail(file, maxLines) {
  if (!existsSync(file)) return '';
  const raw = readFileSync(file, 'utf8');
  const all = raw.split(/\r?\n/);
  return all.slice(-maxLines).join('\n');
}

async function botAlive() {
  try {
    await fetch('http://127.0.0.1:3000/', { signal: AbortSignal.timeout(3_000) });
    return true; // 404 inclus : le serveur écoute.
  } catch {
    return false;
  }
}

async function waitAlive(seconds) {
  const deadline = Date.now() + seconds * 1_000;
  while (Date.now() < deadline) {
    if (await botAlive()) return true;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

function relaunch() {
  if (!existsSync(DIST_ENTRY)) {
    say('REPAIR', 'dist absent : rebuild complet (pnpm build à la racine)...');
    const build = spawnSync('pnpm', ['build'], { cwd: ROOT_DIR, stdio: 'pipe', shell: true, encoding: 'utf8' });
    if (build.status !== 0 || !existsSync(DIST_ENTRY)) {
      say('REPAIR', `rebuild échoué (exit ${build.status}). stderr: ${(build.stderr ?? '').slice(-300)}`);
      return false;
    }
  }
  // Démarrage officiel : `spraxium start` (le ConfigLoader lit
  // .spraxium/dist/spraxium.config.js ; un node direct sur main.mjs casse
  // la résolution du config TS).
  const fd = openSync(LOG_FILE, 'a');
  const child = spawn('pnpm', ['start'], {
    cwd: BOT_DIR,
    detached: true,
    stdio: ['ignore', fd, fd],
    shell: true,
  });
  child.unref();
  say('REPAIR', `bot relancé via pnpm start (pid ${child.pid}), attente du login...`);
  return true;
}

async function checkRedis() {
  const names = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { shell: true, encoding: 'utf8' });
  if (names.status !== 0) return 'docker indisponible';
  const redis = (names.stdout ?? '').split(/\r?\n/).find((n) => n.includes('redis'));
  if (!redis) return 'aucun container redis';
  const ping = spawnSync('docker', ['exec', redis, 'redis-cli', 'ping'], { shell: true, encoding: 'utf8' });
  return (ping.stdout ?? '').trim() === 'PONG' ? 'ok' : `ping KO (${(ping.stderr ?? '').slice(0, 80)})`;
}

async function main() {
  const startedAt = new Date();
  say('CHECK', `guardian démarré à ${startedAt.toISOString()}`);

  // Prisma (audit + sonde) lit process.env : depuis .env ou la valeur par défaut du framework.
  const env = loadEnv();
  process.env.DATABASE_URL ??= env.DATABASE_URL ?? 'file:../data/bot.db';

  // 1-2. Process bot : vivant sinon relance.
  let alive = await botAlive();
  if (!alive) {
    say('REPAIR', 'port 3000 silencieux : relance du bot.');
    relaunch();
    alive = await waitAlive(90);
    if (alive) {
      const boot = tail(LOG_FILE, 40);
      say('REPAIR', boot.includes('Logged in') ? 'bot de nouveau connecté.' : 'port OK mais "Logged in" absent du log.');
    } else {
      say('FAIL', 'relance infructueuse : le port 3000 reste silencieux.');
      console.log('VERDICT: FAIL');
      process.exitCode = 1;
      return;
    }
  } else {
    say('CHECK', 'bot vivant (port 3000).');
  }

  // 3. Redis (la queue bascule en mémoire toute seule si KO : simple avertissement).
  say('CHECK', `redis : ${await checkRedis()}`);

  // 4. Audit : erreurs récentes + fraîcheur des réponses.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  let lastReplyAt = null;
  try {
    const window = new Date(Date.now() - 35 * 60 * 1_000);
    const [errors, jobFails, lastReply] = await Promise.all([
      prisma.auditLog.count({ where: { action: { startsWith: 'assistant.error' }, createdAt: { gte: window } } }),
      prisma.auditLog.count({ where: { action: 'assistant.job.failed', createdAt: { gte: window } } }),
      prisma.auditLog.findFirst({ where: { action: 'assistant.reply' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    lastReplyAt = lastReply?.createdAt ?? null;
    say('CHECK', `audit 35 min : ${errors} erreur(s) assistant, ${jobFails} job(s) échoué(s), dernière réponse ${lastReplyAt?.toISOString() ?? 'jamais'}.`);
    const logWindow = Date.now() - 35 * 60 * 1_000;
    const errorLines = tail(LOG_FILE, 400).split(/\r?\n/).filter((l) => l.includes('ERROR'));
    const recent = errorLines.filter((l) => {
      const t = parseLogTime(l);
      return t && t.getTime() >= logWindow;
    });
    if (recent.length > 0) say('WARN', `${recent.length} ligne(s) ERROR récente(s) : ${recent[recent.length - 1].slice(0, 160)}`);
    if (errors + jobFails > 5) {
      say('FAIL', `${errors + jobFails} incidents audit en 35 min : investigation requise.`);
      console.log('VERDICT: FAIL');
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }

  // 5. Sonde interne : GET /healthz — état DB, queue, gateway. AUCUN message
  // Discord : la surveillance ne spam pas le salon. Les incidents sont de
  // toute façon notifiés en continu par HealthMonitor (alerte sur changement).
  try {
    const headers = env.HTTP_API_KEY ? { 'X-Api-Key': env.HTTP_API_KEY } : {};
    const res = await fetch('http://127.0.0.1:3000/healthz', { headers, signal: AbortSignal.timeout(10_000) });
    const health = await res.json();
    say(
      'PROBE',
      `healthz : ok=${health.ok} db=${health.db} gateway=${health.gatewayReady} driver=${health.driver} queue=${JSON.stringify(health.queue)} uptime=${health.uptimeSec}s.`,
    );
    if (!res.ok || !health.ok) {
      say('FAIL', `/healthz signale un composant en échec (HTTP ${res.status}).`);
      process.exitCode = 1;
    }
  } catch (error) {
    say('FAIL', `sonde /healthz : ${error.message}`);
    process.exitCode = 1;
  }

  console.log(`VERDICT: ${process.exitCode === 1 ? 'FAIL' : 'PASS'}`);
}

main().catch((error) => {
  console.error(`[FAIL] guardian crash: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
