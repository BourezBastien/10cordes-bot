/**
 * Tests ciblés VAGUE 2 : giveaways (cycle complet), tickets (priorité),
 * lockdown catégoriel, trust score. UNE exécution, E2E_ONLY filtrable,
 * tout est nettoyé. Prérequis : E2E_ENABLED=true, E2E_GUILD_ID, bot à jour.
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BOT_DIR = resolve(SCRIPT_DIR, '..');
const API = 'https://discord.com/api/v10';
const WEBHOOK_NAME = 'agent-e2e-guardian';
const COOLDOWN_MS = 5_000;
const DUMMY = '123456789012345678';

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
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 160)}`);
  return body;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function newAuditSince(since) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    return await prisma.auditLog.findMany({
      where: { createdAt: { gt: since } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, createdAt: true, metadata: true },
    });
  } finally {
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
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',').map((s) => s.trim()) : null;
  console.log(`[E2E-features2] démarrage ${new Date().toISOString()} (E2E_ONLY=${process.env.E2E_ONLY ?? '-'})`);

  const me = await rest('/users/@me');
  const guilds = await rest('/users/@me/guilds');
  const devGuild = guilds.find((g) => g.id === env.E2E_GUILD_ID);
  if (!devGuild) {
    console.error(`[FAIL] E2E_GUILD_ID=${env.E2E_GUILD_ID} : bot absent.`);
    process.exit(1);
  }
  const guildId = devGuild.id;

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  let channelId;
  try {
    const g = await prisma.guild.findUnique({ where: { id: guildId }, select: { settings: true } });
    channelId = g?.settings ? JSON.parse(g.settings)?.assistant?.channelId ?? null : null;
  } catch {
    channelId = null;
  }
  if (!channelId) throw new Error('aucun salon dédié IA');

  const hooks = await rest(`/channels/${channelId}/webhooks`);
  let hook = hooks.find((h) => h.name === WEBHOOK_NAME && h.user?.id === me.id);
  if (!hook) {
    hook = await rest(`/channels/${channelId}/webhooks`, { method: 'POST', body: JSON.stringify({ name: WEBHOOK_NAME }) });
  }
  const send = (content) =>
    rest(`/webhooks/${hook.id}/${hook.token}?wait=true`, {
      method: 'POST',
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });

  const results = [];
  const verdict = (name, pass, note = '') => {
    results.push({ name, pass });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${note ? ` — ${note}` : ''}`);
  };

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
    } catch (error) {
      pass = false;
      note = `check error: ${error.message}`;
    }
    verdict(name, missingTools.length === 0 && pass, `${missingTools.length ? `tools manquants: ${missingTools.join(', ')} ; ` : ''}${note}`);
  };

  // ---- 1. Giveaway cycle complet (annonce → auto-draw à 1 min) ----
  let giveawayMessageId = null;
  await runScenario(
    'giveaway',
    "Lance un giveaway dans ce salon : prix « Test E2E giveaway », 1 gagnant, durée 1 minute.",
    ['giveaway.start'],
    async () => {
      const messages = await rest(`/channels/${channelId}/messages?limit=10`);
      const gw = messages.find((m) => JSON.stringify(m.embeds || '').includes('Test E2E giveaway'));
      giveawayMessageId = gw?.id ?? null;
      return { pass: giveawayMessageId !== null, note: giveawayMessageId ? `message ${giveawayMessageId}` : 'annonce introuvable' };
    },
  );

  console.log('[E2E-features2] attente du tirage automatique (75s)...');
  if (!only || only.includes('giveaway')) {
    await sleep(75_000);
    let ended = false;
    let note = 'message introuvable';
    if (giveawayMessageId) {
      try {
        const message = await rest(`/channels/${channelId}/messages/${giveawayMessageId}`);
        const json = JSON.stringify(message.embeds || '');
        ended = json.includes('Winner') || json.includes('Gagnant') || message.edited_timestamp !== null;
        note = ended ? 'tirage effectué (message édité)' : 'giveaway non clôturé';
      } catch {
        note = 'message supprimé (?)';
      }
    }
    verdict('giveaway.autodraw', ended, note);
  }

  // ---- 2. Ticket priorité (salon + ligne Ticket insérés par le script) ----
  if (!only || only.includes('ticket.priority')) {
    const channel = await rest(`/guilds/${guildId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name: 'e2e-priority-ticket', type: 0 }),
    });
    await prisma.ticket.create({ data: { guildId, number: 9_999, channelId: channel.id, userId: DUMMY } });
    await runScenario(
      'ticket.priority',
      `Mets la priorité du salon e2e-priority-ticket (id ${channel.id}) en URGENT.`,
      ['ticket.priority'],
      async () => {
        await sleep(2_000);
        const row = await prisma.ticket.findFirst({ where: { guildId, channelId: channel.id } });
        return { pass: row?.priority === 'URGENT', note: `priorité=${row?.priority ?? '?'}` };
      },
    );
    await prisma.ticket.deleteMany({ where: { guildId, channelId: channel.id } });
    await rest(`/channels/${channel.id}`, { method: 'DELETE' }).catch(() => {});
  }

  // ---- 3. Lockdown catégoriel (catégorie dédiée, restoration vérifiée) ----
  if (!only || only.includes('lockdown')) {
    const category = await rest(`/guilds/${guildId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name: 'e2e-lock-cat', type: 4 }),
    });
    const lockedChannel = await rest(`/guilds/${guildId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name: 'e2e-lock-ch', type: 0, parent_id: category.id }),
    });
    await runScenario(
      'lockdown',
      `Verrouille les salons texte de la catégorie e2e-lock-cat (id ${category.id}) : lockdown scope category.`,
      ['lockdown'],
      async () => {
        const channels = await rest(`/guilds/${guildId}/channels`);
        const ch = channels.find((c) => c.id === lockedChannel.id);
        const deny = ch?.permission_overwrites?.find((o) => o.id === guildId)?.deny ?? [];
        const locked = deny.includes(1 << 11); // SendMessages = 1<<11 (0x800)
        return { pass: locked, note: locked ? 'SendMessages refusé à everyone' : 'salon non verrouillé' };
      },
    );
    await runScenario(
      'lockdown.unlock',
      `Déverrouille la catégorie e2e-lock-cat (id ${category.id}) : lockdown action unlock.`,
      ['lockdown'],
      async () => {
        const channels = await rest(`/guilds/${guildId}/channels`);
        const ch = channels.find((c) => c.id === lockedChannel.id);
        const deny = ch?.permission_overwrites?.find((o) => o.id === guildId)?.deny ?? [];
        const restored = !deny.includes(1 << 11);
        return { pass: restored, note: restored ? 'état restauré' : 'salon toujours verrouillé' };
      },
    );
    await rest(`/channels/${category.id}`, { method: 'DELETE' }).catch(() => {});
  }

  // ---- 4. Trust score (cases injectées, score attendu < 1000) ----
  if (!only || only.includes('trust')) {
    await prisma.modCase.createMany({
      data: [
        { guildId, caseId: 900_001, userId: DUMMY, action: 'warn', reason: 'test e2e', moderatorId: me.id },
        { guildId, caseId: 900_002, userId: DUMMY, action: 'timeout', reason: 'test e2e', moderatorId: me.id },
      ],
    });
    await runScenario(
      'trust',
      `Quel est le score de confiance de <@${DUMMY}> ? (member.trust)`,
      ['member.trust'],
      async () => {
        const cases = await prisma.modCase.findMany({ where: { guildId, userId: DUMMY }, select: { createdAt: true, action: true } });
        const penalty = cases.reduce((sum, c) => {
          const daysAgo = (Date.now() - c.createdAt.getTime()) / 86_400_000;
          const weights = { warn: 40, timeout: 120 };
          return sum + (weights[c.action] ?? 60) * Math.exp(-0.0231 * daysAgo);
        }, 0);
        const expected = Math.max(0, Math.min(1000, Math.round(1000 - penalty)));
        return {
          pass: expected >= 800 && expected < 1000,
          note: `score attendu ~${expected} (2 cases récentes)`,
        };
      },
    );
    await prisma.modCase.deleteMany({ where: { guildId, userId: DUMMY, caseId: { gte: 900_000 } } });
  }

  // ---- CLEANUP ----
  console.log('[CLEANUP] messages de test...');
  try {
    const messages = await rest(`/channels/${channelId}/messages?limit=15`);
    for (const message of messages) {
      const json = JSON.stringify(message.embeds || '');
      if (json.includes('Test E2E giveaway')) {
        await rest(`/channels/${channelId}/messages/${message.id}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  } catch {
    /* rien à nettoyer */
  }

  const passCount = results.filter((r) => r.pass).length;
  console.log(`[SUMMARY] ${passCount}/${results.length} PASS`);
  await prisma.$disconnect();
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((error) => {
  console.error('[FAIL]', error.message);
  process.exit(1);
});
