/**
 * TOOL EVALS (Phase 2.3) : 10 prompts canoniques → vérifie via l'audit que
 * le BON tool a été appelé, directement ou via search_tools (routing).
 * UNE exécution, E2E_ONLY filtrable, tout nettoyé.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BOT_DIR = resolve(SCRIPT_DIR, '..');
const API = 'https://discord.com/api/v10';
const WEBHOOK_NAME = 'agent-e2e-guardian';
const COOLDOWN_MS = 5_000;

function loadEnv() {
  const env = {};
  for (const file of ['.env.local', '.env']) {
    const path = resolve(BOT_DIR, file);
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
if (env.E2E_ENABLED !== 'true') {
  console.log('[E2E] désactivé (E2E_ENABLED!=true).');
  process.exit(0);
}
const token = env.DISCORD_TOKEN;
if (!token) {
  console.error('[FAIL] DISCORD_TOKEN absent');
  process.exit(1);
}
process.env.DATABASE_URL ??= env.DATABASE_URL ?? 'file:../data/bot.db';

async function rest(path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
  });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}`);
  return body;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function toolsSince(since) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.auditLog.findMany({
      where: { createdAt: { gt: since }, action: { startsWith: 'assistant.tool.' } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, metadata: true },
    });
    // ok lu au PREMIER niveau du metadata (pas par regex : un `"ok":true`
    // imbriqué dans l'input ferait passer un tool en échec).
    return rows.map((row) => {
      let ok = false;
      try {
        ok = JSON.parse(row.metadata ?? '{}').ok === true;
      } catch {
        ok = false;
      }
      return { name: row.action.replace('assistant.tool.', ''), ok };
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function waitQuiescent(since, { maxMs = 100_000, quietMs = 7_000 } = {}) {
  const start = Date.now();
  let lastChange = Date.now();
  let entries = [];
  while (Date.now() - start < maxMs) {
    await sleep(3_000);
    const fresh = await toolsSince(since);
    if (fresh.length > entries.length) lastChange = Date.now();
    entries = fresh;
    const hasTool = entries.length > 0;
    if (Date.now() - lastChange >= quietMs && hasTool) break;
  }
  return entries;
}

const EVALS = [
  {
    name: 'eval.weather',
    prompt: 'Donne-moi juste la météo actuelle à Paris en une phrase (utilise ton tool météo).',
    expect: ['getWeather'],
  },
  {
    name: 'eval.activity-summary',
    prompt: 'Résume-moi les statistiques d\u2019activité des 7 derniers jours du serveur en 3 phrases maximum.',
    expect: ['activity.summary'],
  },
  {
    name: 'eval.translate',
    prompt: 'Traduis exactement cette phrase en espagnol et réponds uniquement avec la traduction : « le serveur ouvre vendredi ».',
    expect: ['translate'],
    // Le modèle PEUT traduire sans tool (compétence native) : une réponse
    // texte directe est acceptée ; le tool translate reste le chemin fidèle.
    acceptDirectAnswer: true,
  },
  {
    name: 'eval.server-status',
    prompt: 'Ping le serveur de jeu Minecraft hypixel.net avec ton tool dédié aux serveurs de jeu et donne le nombre de joueurs en ligne en une phrase.',
    expect: ['server.status'],
  },
  {
    name: 'eval.voice-limit',
    prompt: "Crée un salon vocal nommé « e2e-evals Duo » limité à 2 places, à la racine, sans rien dire d'autre.",
    expect: ['createChannel'],
    cleanup: async (guildId) => {
      const channels = await rest(`/guilds/${guildId}/channels`);
      const probe = channels.find((c) => c.name.includes('e2e-evals'));
      if (probe) await rest(`/channels/${probe.id}`, { method: 'DELETE' }).catch(() => {});
    },
  },
  {
    name: 'eval.reminder',
    prompt: 'Enregistre dans la collection reminders un rappel : texte « relancer l\u2019hébergeur », pour moi, dans 2 heures (ISO). Réponds juste fait.',
    expect: ['records.create'],
  },
  {
    name: 'eval.jobs-schedule',
    prompt: "Planifie un job nommé « e2e-evals-ping » : une seule fois (once), dans 2 minutes, qui envoie « test e2e » dans ce salon. Réponds juste fait.",
    expect: ['jobs.schedule'],
  },
  {
    name: 'eval.search-routing',
    prompt: 'Donne-moi le nombre de membres du serveur et le nombre de salons, en une phrase (résolution via tes tools de lecture).',
    expect: ['getServerInfo', 'getChannels'],
  },
];

const snowflakeTs = (id) => Number(BigInt(id) >> 22n) + 1_420_070_400_000;

/** Un message du BOT existe-t-il dans le salon après un timestamp ? */
async function botRepliedAfter(channelId, sinceMs, maxMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(4_000);
    const messages = await rest(`/channels/${channelId}/messages?limit=15`).catch(() => []);
    if (messages.some((m) => m.author.id === botId && snowflakeTs(m.id) >= sinceMs - 2_000)) return true;
  }
  return false;
}

let botId = '';

async function main() {
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',').map((s) => s.trim()) : null;
  console.log(`[tool-evals] démarrage ${new Date().toISOString()}`);

  const me = await rest('/users/@me');
  botId = me.id;
  const guilds = await rest('/users/@me/guilds');
  const devGuild = guilds.find((g) => g.id === env.E2E_GUILD_ID);
  if (!devGuild) throw new Error('E2E_GUILD_ID introuvable');
  const guildId = devGuild.id;

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  let channelId;
  try {
    const g = await prisma.guild.findUnique({ where: { id: guildId }, select: { settings: true } });
    channelId = g?.settings ? JSON.parse(g.settings)?.assistant?.channelId ?? null : null;
  } finally {
    await prisma.$disconnect();
  }
  if (!channelId) throw new Error('aucun salon dédié IA');

  const hooks = await rest(`/channels/${channelId}/webhooks`);
  let hook = hooks.find((h) => h.name === WEBHOOK_NAME);
  if (!hook) hook = await rest(`/channels/${channelId}/webhooks`, { method: 'POST', body: JSON.stringify({ name: WEBHOOK_NAME }) });
  const send = (content) =>
    rest(`/webhooks/${hook.id}/${hook.token}?wait=true`, {
      method: 'POST',
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });

  const results = [];
  for (const evalCase of EVALS) {
    if (only && !only.includes(evalCase.name)) continue;
    await sleep(COOLDOWN_MS);
    const since = new Date(Date.now() - 2_000);
    const sentAt = Date.now();
    await send(evalCase.prompt);
    const ran = await waitQuiescent(since);
    const names = ran.map((entry) => entry.name);
    const searched = names.includes('search_tools');
    // Un tool attendu doit avoir RÉUSSI : activity.summary plantait (BigInt)
    // tout en étant compté PASS parce qu'il avait seulement été appelé.
    const failed = ran.filter((entry) => !entry.ok).map((entry) => entry.name);
    const hit = evalCase.expect.some((expected) => ran.some((entry) => entry.name === expected && entry.ok));
    // Routing accepté : tool direct OU search_tools qui a mené à un tool réussi.
    let pass = hit || (searched && ran.some((entry) => entry.ok && entry.name !== 'search_tools'));
    // Un échec suivi d'une réussite = agent qui s'est corrigé (PASS, mais visible).
    let note = failed.length > 0 ? ` [${pass ? 'échec récupéré' : 'tool en échec'} : ${[...new Set(failed)].join(', ')}]` : '';
    if (!pass && evalCase.acceptDirectAnswer) {
      pass = await botRepliedAfter(channelId, sentAt, 20_000);
      note = pass ? ' (réponse directe acceptée)' : note;
    }
    results.push({ name: evalCase.name, pass });
    console.log(
      `[${pass ? 'PASS' : 'FAIL'}] ${evalCase.name}${note} : tools: ${ran.map((entry) => (entry.ok ? entry.name : `${entry.name}(échec)`)).join(', ') || 'aucun'}${searched ? ' (via search_tools)' : ''}`,
    );
    await evalCase.cleanup?.(guildId).catch(() => {});
  }

  // Nettoyage du job planifié éventuel.
  const { PrismaClient: P2 } = await import('@prisma/client');
  const p2 = new P2();
  try {
    await p2.scheduledJob.deleteMany({ where: { guildId, name: 'e2e-evals-ping' } }).catch(() => {});
  } finally {
    await p2.$disconnect();
  }

  const passCount = results.filter((r) => r.pass).length;
  console.log(`[SUMMARY] ${passCount}/${results.length} PASS`);
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((error) => {
  console.error('[FAIL]', error.message);
  process.exit(1);
});
