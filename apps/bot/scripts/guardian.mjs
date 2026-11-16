/**
 * Guardian 10cordes : santé du bot + relance + sonde E2E live.
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
 *  5. Sonde E2E : message webhook dans le salon dédié IA (ou mention sinon),
 *     succès si une nouvelle ligne audit `assistant.reply` arrive sous 120s.
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
const PROBE_WEBHOOK_NAME = 'agent-e2e-guardian';
const API = 'https://discord.com/api/v10';

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

async function rest(token, path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
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

  // 5. Sonde E2E : webhook -> salon dédié -> nouvelle réponse audité sous 120s.
  const env = loadEnv();
  const token = env.DISCORD_TOKEN;
  if (!token) {
    say('PROBE', 'DISCORD_TOKEN introuvable dans .env : sonde sautée.');
  } else {
    try {
      const me = await rest(token, '/users/@me');
      const guilds = await rest(token, `/users/@me/guilds`);
      if (guilds.length === 0) throw new Error('aucun serveur');
      const guildId = guilds[0].id;

      const prisma = new PrismaClient();
      let channelId = null;
      try {
        const g = await prisma.guild.findUnique({ where: { id: guildId }, select: { settings: true } });
        channelId = g?.settings ? JSON.parse(g.settings)?.assistant?.channelId ?? null : null;
      } finally {
        await prisma.$disconnect();
      }
      if (!channelId) {
        const channels = await rest(token, `/guilds/${guildId}/channels`);
        channelId = channels.find((c) => c.type === 0)?.id ?? null;
      }
      if (!channelId) throw new Error('aucun salon texte trouvé');

      const hooks = await rest(token, `/channels/${channelId}/webhooks`);
      let hook = hooks.find((h) => h.name === PROBE_WEBHOOK_NAME && h.user?.id === me.id);
      if (!hook) {
        hook = await rest(token, `/channels/${channelId}/webhooks`, {
          method: 'POST',
          body: JSON.stringify({ name: PROBE_WEBHOOK_NAME }),
        });
        say('PROBE', `webhook de sonde créé dans ${channelId}.`);
      }

      const probeStart = new Date(Date.now() - 2_000);
      const content = `Sonde de surveillance automatique (${startedAt.toISOString()}) : réponds en une seule phrase courte.`;
      await rest(token, `/webhooks/${hook.id}/${hook.token}?wait=true`, {
        method: 'POST',
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      });
      say('PROBE', `message envoyé dans ${channelId}, attente de la réponse de l'agent...`);

      const prisma2 = new PrismaClient();
      let answered = false;
      try {
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline && !answered) {
          await new Promise((r) => setTimeout(r, 5_000));
          const hit = await prisma2.auditLog.findFirst({
            where: { action: { in: ['assistant.reply', 'assistant.error'] }, createdAt: { gte: probeStart } },
            orderBy: { createdAt: 'desc' },
            select: { action: true, createdAt: true, metadata: true },
          });
          if (hit) {
            if (hit.action === 'assistant.reply') {
              answered = true;
              say('PROBE', `réponse de l'agent audité à ${hit.createdAt.toISOString()}.`);
            } else {
              say('FAIL', `l'agent a traité la sonde en erreur : ${hit.metadata.slice(0, 200)}`);
              process.exitCode = 1;
            }
          }
        }
      } finally {
        await prisma2.$disconnect();
      }
      if (!answered && process.exitCode !== 1) {
        say('FAIL', 'aucune réponse auditée sous 120s : la chaîne agent ne répond pas.');
        process.exitCode = 1;
      }
    } catch (error) {
      say('FAIL', `sonde E2E : ${error.message}`);
      process.exitCode = 1;
    }
  }

  console.log(`VERDICT: ${process.exitCode === 1 ? 'FAIL' : 'PASS'}`);
}

main().catch((error) => {
  console.error(`[FAIL] guardian crash: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
