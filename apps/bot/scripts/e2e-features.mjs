/**
 * Tests ciblés des FEATURES récentes — UNE seule exécution, pas de re-run
 * des scénarios historiques (interdiction owner : pas de tests en boucle).
 * Couvre : sondage (création + clôture auto + résultats), vocal (join/leave),
 * panel avec bouton lien. Ne touche à rien d'existant : tout est nettoyé.
 *
 * Prérequis : E2E_ENABLED=true, E2E_GUILD_ID, bot redémarré sur le build testé.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
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
    headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json' },
  });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 160)}`);
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newAuditSince(since) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    return await prisma.auditLog.findMany({
      where: { createdAt: { gt: since } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, createdAt: true, metadata: true },
    });
  }
  finally {
    await prisma.$disconnect();
  }
}

async function waitQuiescent(watermark, { maxMs = 100_000, quietMs = 6_000 } = {}) {
  const start = Date.now();
  let entries = [];
  let lastChange = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(3_000);
    entries = await newAuditSince(watermark);
    if (entries.length > 0) lastChange = Date.now();
    const hasTool = entries.some((e) => e.action.startsWith('assistant.tool.'));
    if (Date.now() - lastChange >= quietMs && hasTool) break;
  }
  return entries;
}

async function main() {
  const startedAt = new Date();
  console.log(`[E2E-features] démarrage ${startedAt.toISOString()}`);

  const me = await rest('/users/@me');
  const guilds = await rest('/users/@me/guilds');
  const devGuild = guilds.find((g) => g.id === env.E2E_GUILD_ID);
  if (!devGuild) {
    console.error(`[FAIL] E2E_GUILD_ID=${env.E2E_GUILD_ID} : bot absent du serveur.`);
    process.exit(1);
  }
  const guildId = devGuild.id;

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  let channelId;
  try {
    const g = await prisma.guild.findUnique({ where: { id: guildId }, select: { settings: true } });
    channelId = g?.settings ? JSON.parse(g.settings)?.assistant?.channelId ?? null : null;
  }
  finally {
    await prisma.$disconnect();
  }
  if (!channelId) throw new Error('aucun salon dédié IA configuré');

  const existingHooks = await rest(`/channels/${channelId}/webhooks`);
  let hook = existingHooks.find((h) => h.name === WEBHOOK_NAME && h.user?.id === me.id);
  if (!hook) {
    hook = await rest(`/channels/${channelId}/webhooks`, { method: 'POST', body: JSON.stringify({ name: WEBHOOK_NAME }) });
  }
  const send = (content) => rest(`/webhooks/${hook.id}/${hook.token}?wait=true`, {
    method: 'POST',
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });

  const results = [];
  const verdict = (name, pass, note = '') => {
    results.push({ name, pass });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${note ? ` — ${note}` : ''}`);
  };

  // E2E_ONLY="scenario1,scenario2" pour ne rejouer qu'une partie (obligatoire
  // pour toute re-validation ciblée : interdiction de re-spammer les autres).
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',').map((s) => s.trim()) : null;
  const runScenario = async (name, prompt, expectTools, check) => {
    if (only && !only.includes(name)) return;
    const watermark = new Date(Date.now() - 2_000);
    await sleep(COOLDOWN_MS);
    await send(prompt);
    const entries = await waitQuiescent(watermark);
    const toolActions = entries.filter((e) => e.action.startsWith('assistant.tool.'));
    const missingTools = expectTools.filter((t) => !toolActions.some((e) => e.action === `assistant.tool.${t}`));
    let note = '';
    let pass = true;
    try {
      const out = await check({ entries });
      pass = out.pass;
      note = out.note ?? '';
    }
    catch (error) {
      pass = false;
      note = `check error: ${error.message}`;
    }
    verdict(name, missingTools.length === 0 && pass, `${missingTools.length ? `tools manquants: ${missingTools.join(', ')} ; ` : ''}${note}`);
  };

  // ---- 1. Sondage : création puis clôture automatique avec résultats ----
  let pollMessageId = null;
  const pollsSelected = !only || only.includes('polls.create');
  await runScenario(
    'polls.create',
    'Crée un sondage ici : question « Test E2E polls ? » avec deux options « Oui » et « Non », durée 1 minute.',
    ['createPoll'],
    async () => {
      const messages = await rest(`/channels/${channelId}/messages?limit=10`);
      const poll = messages.find(
        (m) => (m.content?.includes('Test E2E polls') || JSON.stringify(m.components || '').includes('Test E2E polls'))
          && (m.components?.length ?? 0) > 0,
      );
      pollMessageId = poll?.id ?? null;
      return { pass: pollMessageId !== null, note: pollMessageId ? `message ${pollMessageId}` : 'message de sondage introuvable' };
    },
  );

  console.log('[E2E-features] attente de la clôture automatique (75s)...');
  if (pollsSelected) await sleep(75_000);
  if (pollsSelected) {
    let closed = false;
    let note = 'message introuvable';
    if (pollMessageId) {
      try {
        const message = await rest(`/channels/${channelId}/messages/${pollMessageId}`);
        const componentsJson = JSON.stringify(message.components || '');
        const hasResults = message.content?.includes('Résultats') || componentsJson.includes('Résultats');
        // En V2 le Container de résultats reste (titre + barres) : ce qui doit
        // disparaître, ce sont les boutons (custom_id présent uniquement eux).
        const noButtons = !componentsJson.includes('custom_id');
        closed = hasResults && noButtons;
        note = hasResults ? (noButtons ? 'résultats publiés, boutons retirés' : 'résultats mais boutons encore présents') : 'clôture non éditée';
      }
      catch {
        note = 'message supprimé (?)';
      }
    }
    verdict('polls.autoclose', closed, note);
  }

  // ---- 2. Vocal : join puis leave ----
  let vcId = null;
  const vc = await rest(`/guilds/${guildId}/channels`, { method: 'POST', body: JSON.stringify({ name: 'e2e-vc-temp', type: 2 }) });
  vcId = vc.id;
  await runScenario(
    'voice.join',
    'Rejoins le salon vocal e2e-vc-temp.',
    ['voice.join'],
    async () => {
      const state = await rest(`/guilds/${guildId}/voice-states/${me.id}`).catch(() => null);
      return { pass: state !== null && state.channel_id === vcId, note: state ? `connecté à ${state.channel_id}` : 'pas connecté' };
    },
  );
  await runScenario(
    'voice.leave',
    'Quitte le vocal.',
    ['voice.leave'],
    async () => {
      await sleep(3_000);
      const state = await rest(`/guilds/${guildId}/voice-states/${me.id}`).catch(() => null);
      return { pass: state === null, note: state ? 'encore connecté' : 'déconnecté' };
    },
  );

  // ---- 3. Panel avec bouton lien (composants à la volée) ----
  let panelMessageId = null;
  await runScenario(
    'panel.link',
    'Poste un panel ici : titre « Test E2E panel », description « un essai de composants », et un seul bouton lien vers https://example.com intitulé « Docs ».',
    ['sendPanel'],
    async () => {
      const messages = await rest(`/channels/${channelId}/messages?limit=10`);
      const panel = messages.find((m) => m.content?.includes('Test E2E panel') || JSON.stringify(m.components || '').includes('Test E2E panel'));
      panelMessageId = panel?.id ?? null;
      const hasLink = panel ? JSON.stringify(panel.components || '').includes('https://example.com') : false;
      return { pass: panelMessageId !== null && hasLink, note: panelMessageId ? (hasLink ? 'panel + bouton lien' : 'panel sans lien') : 'panel introuvable' };
    },
  );

  // ---- CLEANUP ----
  console.log('[CLEANUP]...');
  for (const messageId of [pollMessageId, panelMessageId].filter(Boolean)) {
    await rest(`/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' }).catch(() => {});
  }
  if (vcId) await rest(`/channels/${vcId}`, { method: 'DELETE' }).catch(() => {});

  const passCount = results.filter((r) => r.pass).length;
  console.log(`[SUMMARY] ${passCount}/${results.length} PASS`);
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((error) => {
  console.error('[FAIL]', error.message);
  process.exit(1);
});
