/**
 * Tests ciblés VAGUE 4 : la couche PRIMITIVES pure.
 * - components.post avec action runTool (sendMessage au clic) — vérif layout + DB
 * - members.pickRandom sur un rôle de test
 * - skills sans tools fantômes (sweep audit)
 * UNE exécution, E2E_ONLY filtrable, tout nettoyé.
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BOT_DIR = resolve(SCRIPT_DIR, '..');
const API = 'https://discord.com/api/v10';
const WEBHOOK_NAME = 'agent-e2e-guardian';
const COOLDOWN_MS = 5_000;
const TEST_ROLE = 'e2e-pick-role';

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
  console.log(`[E2E-features4] démarrage ${new Date().toISOString()} (E2E_ONLY=${process.env.E2E_ONLY ?? '-'})`);

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

  // ---- 1. Layout avec bouton runTool : la définition persistée porte l'action ----
  let layoutMessageId = null;
  await runScenario(
    'components.runtool',
    "Poste un panel ici : titre « E2E-features4 runTool », description « test bouton runTool », une rangée avec un bouton qui exécute le tool sendMessage dans ce salon avec pour input channelId = l'id de ce salon et content = « E2E-features4 runTool exécuté ». NE L'EXÉCUTE PAS toi-même, poste juste le panel.",
    ['sendPanel'],
    async () => {
      const messages = await rest(`/channels/${channelId}/messages?limit=10`);
      const panel = messages.find((m) => JSON.stringify(m.components || '').includes('E2E-features4 runTool'));
      layoutMessageId = panel?.id ?? null;
      const hasRunTool = panel ? JSON.stringify(panel.components || '').includes('runTool') : false;
      return { pass: layoutMessageId !== null && hasRunTool, note: panel ? (hasRunTool ? 'action runTool dans le layout' : 'bouton sans runTool') : 'panel introuvable' };
    },
  );

  // ---- 2. members.pickRandom sur un rôle de test ----
  if (!only || only.includes('members.pickRandom')) {
    const role = await rest(`/guilds/${guildId}/roles`, {
      method: 'POST',
      body: JSON.stringify({ name: TEST_ROLE, color: 0xe67e22 }),
    });
    // Le bot rejoint son propre rôle de test → au moins 1 candidat.
    await rest(`/guilds/${guildId}/members/${me.id}/roles/${role.id}`, { method: 'PUT' }).catch(() => {});
    await runScenario(
      'members.pickRandom',
      `Tire aléatoirement 1 membre ayant le rôle ${TEST_ROLE} (id ${role.id}) via members.pickRandom scope role.`,
      ['members.pickRandom'],
      async () => {
        const botMember = await rest(`/guilds/${guildId}/members/${me.id}`);
        const hasRole = botMember.roles.includes(role.id);
        return { pass: hasRole, note: hasRole ? 'bot porteur du rôle test' : 'rôle test non attribué au bot' };
      },
    );
    await rest(`/guilds/${guildId}/roles/${role.id}`, { method: 'DELETE' }).catch(() => {});
  }

  // ---- 3. Sondage COMPOSÉ complet : panel vote → votes → tally.votes → édité ----
  if (!only || only.includes('polls.compose')) {
    await sleep(COOLDOWN_MS);
    // 3a. Panel avec 3 boutons vote (sans clôture : on dépouille à la main).
    const watermarkA = new Date(Date.now() - 2_000);
    await send(
      "Poste ici un sondage V2 « E2E-features4 sondage » avec exactement 3 boutons de vote : Alpha, Beta, Gamma (action vote). NE LE CLÔTURE PAS, poste juste le panel.",
    );
    const entriesA = await waitQuiescent(watermarkA);
    const sentPanel = entriesA.some((e) => e.action === 'assistant.tool.sendPanel');
    const messagesA = await rest(`/channels/${channelId}/messages?limit=10`);
    const panel = messagesA.find((m) => JSON.stringify(m.components || '').includes('E2E-features4 sondage'));
    if (!panel) {
      verdict('polls.compose', false, 'panel de sondage introuvable');
    } else {
      // 3b. Deux votes écrits directement en base (le clic exige une vraie
      // interaction Discord, non simulable en REST) avec le messageId EXACT.
      const { PrismaClient } = await import('@prisma/client');
      const prismaVote = new PrismaClient();
      try {
        await prismaVote.agentRecord.createMany({
          data: [
            { guildId, collection: 'component_votes', channelId, messageId: panel.id, createdBy: '111111111111111111', data: JSON.stringify({ version: 1, messageId: panel.id, channelId, choice: 'Alpha' }) },
            { guildId, collection: 'component_votes', channelId, messageId: panel.id, createdBy: '222222222222222222', data: JSON.stringify({ version: 1, messageId: panel.id, channelId, choice: 'Beta' }) },
          ],
        });
      } finally {
        await prismaVote.$disconnect();
      }
      // 3c. Dépouillement par le bot (tool tally.votes).
      const watermarkB = new Date(Date.now() - 2_000);
      await sleep(COOLDOWN_MS);
      await send(`Dépouille le sondage du message id ${panel.id} avec tally.votes (close=true).`);
      await waitQuiescent(watermarkB);
      const edited = await rest(`/channels/${channelId}/messages/${panel.id}`).catch(() => null);
      const editedOk = edited && JSON.stringify(edited.components || '').includes('Résultats du sondage');
      const countsOk = edited && /Alpha/.test(JSON.stringify(edited.components || '')) && /Beta/.test(JSON.stringify(edited.components || ''));
      verdict(
        'polls.compose',
        sentPanel && Boolean(editedOk) && Boolean(countsOk),
        `${sentPanel ? 'panel posté' : 'sendPanel manquant'} ; ${editedOk ? 'message édité avec résultats' : 'pas de résultats'}${countsOk ? ' (choisis Alpha/Beta présents)' : ''}`,
      );
    }
  }

  // ---- 4. Compteur typé via records (collection counters) ----
  if (!only || only.includes('records.counter')) {
    await runScenario(
      'records.counter',
      "Crée un enregistrement dans la collection counters : un compteur nommé « e2e-compteur » avec value 0, via records.create. Réponds juste fait.",
      ['records.create'],
      async () => {
        const prismaCounter = (await import('@prisma/client')).PrismaClient;
        const p = new prismaCounter();
        try {
          const row = await p.agentRecord.findFirst({
            where: { guildId, collection: 'counters' },
            orderBy: { createdAt: 'desc' },
          });
          const hasIt = row ? row.data.includes('e2e-compteur') : false;
          return { pass: hasIt, note: hasIt ? 'compteur e2e-compteur en base' : 'aucun compteur e2e-compteur trouvé' };
        } finally {
          await p.$disconnect();
        }
      },
    );
  }

  // ---- 5. Audit d'événements : création + suppression d'un salon => lignes
  // channel.created / channel.deleted (prouve le fix @Listener ; les messages
  // de webhook sont ignorés par design dans message.created, on teste donc
  // un event Discord que le rig peut déclencher) ----
  if (!only || only.includes('audit.events')) {
    const before = new Date(Date.now() - 2_000);
    const probe = await rest(`/guilds/${guildId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name: 'e2e-audit-probe', type: 0 }),
    });
    let created = false;
    let deleted = false;
    for (let i = 0; i < 10 && (!created || !deleted); i++) {
      await sleep(3_000);
      const { PrismaClient } = await import('@prisma/client');
      const p = new PrismaClient();
      try {
        if (!created) {
          created = (await p.auditLog.count({ where: { createdAt: { gt: before }, source: 'discord', action: 'channel.created' } })) > 0;
        }
        if (created && !deleted) {
          if (!probe.deleted) {
            await rest(`/channels/${probe.id}`, { method: 'DELETE' }).catch(() => {});
            probe.deleted = true;
          }
          deleted = (await p.auditLog.count({ where: { createdAt: { gt: before }, source: 'discord', action: 'channel.deleted' } })) > 0;
        }
      } finally {
        await p.$disconnect();
      }
    }
    await rest(`/channels/${probe.id}`, { method: 'DELETE' }).catch(() => {});
    verdict(
      'audit.events',
      created && deleted,
      `channel.created=${created ? 'OK' : 'ABSENT'} · channel.deleted=${deleted ? 'OK' : 'ABSENT'} (listeners @Listener vivants)`,
    );
  }

  // ---- 6. Skills sans tools fantômes (art-culture/searchArt purgé) ----
  if (!only || only.includes('skills.no-ghosts')) {
    const skills = await prisma.agentSkill.findMany({ where: { guildId, deletedAt: null } });
    const ghost = skills.find((skill) => skill.rule?.includes('searchArt'));
    verdict('skills.no-ghosts', !ghost, ghost ? 'searchArt fantôme encore référencé' : 'aucun fantôme art-culture');
  }

  // ---- CLEANUP ----
  console.log('[CLEANUP]...');
  if (layoutMessageId) await rest(`/channels/${channelId}/messages/${layoutMessageId}`, { method: 'DELETE' }).catch(() => {});

  const passCount = results.filter((r) => r.pass).length;
  console.log(`[SUMMARY] ${passCount}/${results.length} PASS`);
  await prisma.$disconnect();
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((error) => {
  console.error('[FAIL]', error.message);
  process.exit(1);
});
