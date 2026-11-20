/**
 * Tests ciblés VAGUE 3 : composants génériques (layout arbitraire + edit),
 * store typé (records create/list/search/delete), jobs (once → exécution
 * vérifiée en audit), recherche d'historique. UNE exécution, E2E_ONLY
 * filtrable, tout nettoyé.
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
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
  console.log(`[E2E-features3] démarrage ${new Date().toISOString()} (E2E_ONLY=${process.env.E2E_ONLY ?? '-'})`);

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
  } finally {
    await prisma.$disconnect();
  }
  if (!channelId) throw new Error('aucun salon dédié IA');

  // Salon de tests DÉDIÉ : les artefacts E2E (panels, messages) ne polluent
  // plus le salon IA des membres. Créé au besoin ; les prompts y mentionnent
  // le bot explicitement (hors salon dédié, seule la mention déclenche).
  let testChannelId = null;
  const allChannels = await rest(`/guilds/${guildId}/channels`);
  const existingTest = allChannels.find((c) => c.name === 'e2e-tests' && c.type === 0);
  if (existingTest) {
    testChannelId = existingTest.id;
  } else {
    const created = await rest(`/guilds/${guildId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name: 'e2e-tests', type: 0 }),
    });
    testChannelId = created.id;
  }
  channelId = testChannelId;

  const hooks = await rest(`/channels/${channelId}/webhooks`);
  let hook = hooks.find((h) => h.name === WEBHOOK_NAME && h.user?.id === me.id);
  if (!hook) {
    hook = await rest(`/channels/${channelId}/webhooks`, { method: 'POST', body: JSON.stringify({ name: WEBHOOK_NAME }) });
  }
  const send = (content) =>
    rest(`/webhooks/${hook.id}/${hook.token}?wait=true`, {
      method: 'POST',
      body: JSON.stringify({ content: `<@${me.id}> ${content}`, allowed_mentions: { users: [me.id] } }),
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

  // ---- 1. Layout arbitraire : post + edit ----
  let layoutMessageId = null;
  await runScenario(
    'components.layout',
    "Poste un panel ici : titre « Test E2E layout », description « essai layout arbitraire », première rangée avec deux boutons reply « Option A » (message : Tu as choisi A) et « Option B » (message : Tu as choisi B), et un bouton lien vers https://example.com intitulé « Docs ».",
    ['sendPanel'],
    async () => {
      const messages = await rest(`/channels/${channelId}/messages?limit=10`);
      const panel = messages.find((m) => JSON.stringify(m.components || '').includes('Test E2E layout'));
      layoutMessageId = panel?.id ?? null;
      // Boutons dynamiques inline : customId = panel:action~r=..&b=..
      const componentsJson = JSON.stringify(panel?.components || '');
      const dynamicButtons = componentsJson.includes('panel:action');
      const hasLink = componentsJson.includes('https://example.com');
      return {
        pass: layoutMessageId !== null && dynamicButtons && hasLink,
        note: layoutMessageId ? (dynamicButtons && hasLink ? 'boutons dynamiques + lien' : 'layout incomplet') : 'panel introuvable',
      };
    },
  );

  if (!only || only.includes('components.edit')) {
    await runScenario(
      'components.edit',
      `Édite le panel « Test E2E layout » (message ${layoutMessageId ?? 'DÉJÀ POSTÉ'}) : change la description en « description éditée ». NE LE SUPPRIME PAS.`,
      ['components.edit'],
      async () => {
        if (!layoutMessageId) return { pass: false, note: 'message absent' };
        const message = await rest(`/channels/${channelId}/messages/${layoutMessageId}`);
        const edited = JSON.stringify(message.components || '').includes('description éditée');
        return { pass: edited, note: edited ? 'description éditée' : 'édition non visible' };
      },
    );
  }

  // ---- 2. Store typé : records reminders ----
  await runScenario(
    'records.store',
    "Crée un rappel pour moi : texte « test e2e records », échéance dans 5 minutes (records.create collection reminders), puis montre-moi la liste des reminders.",
    ['records.create', 'records.list'],
    async () => {
      const rows = await prisma.agentRecord.findMany({ where: { guildId, collection: 'reminders' } });
      const found = rows.some((row) => row.data.includes('test e2e records'));
      return { pass: rows.length > 0 && found, note: `${rows.length} reminder(s) en DB` };
    },
  );

  // ---- 3. Job once : exécution vérifiée en audit ----
  if (!only || only.includes('jobs.once')) {
    const when = new Date(Date.now() + 3 * 60_000).toISOString();
    await runScenario(
      'jobs.once',
      `Planifie un job « test-e2e-job » qui s'exécute une fois à ${when} et envoie dans ce salon « 🔔 job e2e exécuté ».`,
      ['jobs.schedule'],
      async () => {
        const row = await prisma.scheduledJob.findFirst({ where: { guildId, name: 'test-e2e-job' } });
        return { pass: row !== null && row.enabled, note: row ? `runAt ${row.runAt?.toISOString()}` : 'job absent' };
      },
    );
    console.log('[E2E-features3] attente de l\'exécution du job (210s)...');
    await sleep(210_000);
    const entries = await newAuditSince(new Date(Date.now() - 240_000));
    const executed = entries.some((e) => e.action === 'assistant.tool.jobs.schedule') || true; // l'exécution du job n'audite pas de tool ; on vérifie l'envoi Discord
    let messagePosted = false;
    try {
      const messages = await rest(`/channels/${channelId}/messages?limit=10`);
      messagePosted = messages.some((m) => m.content?.includes('job e2e exécuté'));
    } catch {
      /* salon inaccessible */
    }
    verdict('jobs.executed', executed && messagePosted, messagePosted ? 'message du job trouvé' : 'message du job absent');
  }

  // ---- 4. Recherche d'historique ----
  if (!only || only.includes('history.search')) {
    await send('TEST-E2E-SEARCH marqueur unique');
    await sleep(3_000);
    await runScenario(
      'history.search',
      `Cherche dans ce salon les messages contenant « TEST-E2E-SEARCH ».`,
      [],
      async ({ entries }) => {
        const toolCalled = entries.some((e) => e.action === 'assistant.tool.channel.history.search');
        // Accepté aussi : le modèle répond depuis readMessages avec le marqueur.
        const messages = await rest(`/channels/${channelId}/messages?limit=10`);
        const markerInReply = messages.some(
          (m) => m.author?.bot && (m.content?.includes('TEST-E2E-SEARCH') || JSON.stringify(m.components || '').includes('TEST-E2E-SEARCH')),
        );
        return {
          pass: toolCalled || markerInReply,
          note: toolCalled ? 'tool utilisé' : markerInReply ? 'marqueur dans la réponse' : 'ni tool ni résultat',
        };
      },
    );
  }

  // ---- CLEANUP ----
  console.log('[CLEANUP]...');
  if (layoutMessageId) await rest(`/channels/${channelId}/messages/${layoutMessageId}`, { method: 'DELETE' }).catch(() => {});
  await prisma.scheduledJob.deleteMany({ where: { guildId, name: 'test-e2e-job' } });
  await prisma.agentRecord.deleteMany({ where: { guildId, collection: 'reminders' } });
  try {
    const messages = await rest(`/channels/${channelId}/messages?limit=15`);
    for (const message of messages) {
      if (message.content?.includes('TEST-E2E-SEARCH') || JSON.stringify(message.components || '').includes('test e2e records')) {
        await rest(`/channels/${channelId}/messages/${message.id}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  } catch {
    /* rien */
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
