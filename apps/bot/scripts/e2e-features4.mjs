/**
 * Tests ciblés VAGUE 4 : la couche PRIMITIVES pure.
 * - surface.create avec pipeline runTool (sendMessage au clic) : vérif message + définition persistée
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
// L'adresse est relative à apps/bot (la règle du bot : src/modules/database/database-url.ts).
process.env.DATABASE_URL ??= env.DATABASE_URL ?? 'file:./data/bot.db';

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
  const { createDatabaseClient } = await import('../src/modules/database/database-client.ts');
  const prisma = createDatabaseClient(process.env.DATABASE_URL);
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

  const { createDatabaseClient } = await import('../src/modules/database/database-client.ts');
  const prisma = createDatabaseClient(process.env.DATABASE_URL);
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
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${note ? ` : ${note}` : ''}`);
  };

  /** Un tool n'est compté que s'il a RÉUSSI (ok:true au premier niveau du metadata). */
  const toolMeta = (entry) => {
    try {
      return JSON.parse(entry.metadata ?? '{}');
    } catch {
      return {};
    }
  };
  const failedTools = (entries) =>
    entries
      .filter((e) => e.action.startsWith('assistant.tool.') && toolMeta(e).ok !== true)
      .map((e) => `${e.action.replace('assistant.tool.', '')} (${String(toolMeta(e).summary ?? 'sans motif').slice(0, 90)})`);

  const runScenario = async (name, prompt, expectTools, check) => {
    if (only && !only.includes(name)) return;
    const watermark = new Date(Date.now() - 2_000);
    await sleep(COOLDOWN_MS);
    await send(prompt);
    const entries = await waitQuiescent(watermark);
    // STRICT : le tool attendu doit avoir réussi. L'ancien contrôle ne
    // regardait que le nom : members.pickRandom a été compté PASS alors que
    // ses deux appels avaient échoué.
    const missingTools = expectTools.filter((t) => !entries.some((e) => e.action === `assistant.tool.${t}` && toolMeta(e).ok === true));
    const failed = failedTools(entries);
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
    verdict(name, missingTools.length === 0 && pass, `${missingTools.length ? `tools sans succès: ${missingTools.join(', ')} ; ` : ''}${note}${failed.length ? ` [tools en échec : ${failed.join(' ; ')}]` : ''}`);
  };

  // ---- 1. Surface avec bouton runTool : la définition persistée porte le pipeline ----
  let layoutMessageId = null;
  let layoutSurfaceId = null;
  await runScenario(
    'surface.runtool',
    `Crée une surface ici (surface.create, channelId = ${channelId}) : titre « E2E-features4 runTool », description « test bouton runTool », une rangée avec un bouton « Exécuter » dont le pipeline exécute runTool (tool sendMessage, input channelId = ${channelId} et content = « E2E-features4 runTool exécuté »). NE L'EXÉCUTE PAS toi-même, crée juste la surface.`,
    ['surface.create'],
    async () => {
      const messages = await rest(`/channels/${channelId}/messages?limit=10`);
      const panel = messages.find((m) => JSON.stringify(m.components || '').includes('E2E-features4 runTool'));
      layoutMessageId = panel?.id ?? null;
      // La définition persistée (InteractiveSurface.definition) doit porter
      // le pipeline runTool : c'est ça qui survit aux redémarrages.
      const p = createDatabaseClient(process.env.DATABASE_URL);
      try {
        const row = await p.interactiveSurface.findFirst({
          where: { guildId, channelId },
          orderBy: { createdAt: 'desc' },
        });
        layoutSurfaceId = row?.id ?? null;
        const hasRunTool = row ? row.definition.includes('runTool') : false;
        return { pass: layoutMessageId !== null && hasRunTool, note: panel ? (hasRunTool ? 'pipeline runTool dans la définition persistée' : 'définition sans runTool') : 'message surface introuvable' };
      } finally {
        await p.$disconnect();
      }
    },
  );

  // ---- 2. members.pickRandom : un vrai tirage parmi les membres humains ----
  // L'ancienne version donnait un rôle de test au BOT lui-même, que le tool
  // exclut par principe (excludeBots) : « aucun candidat » était garanti et le
  // scénario ne vérifiait que le rôle, jamais le tirage. Ici : scope all.
  await runScenario(
    'members.pickRandom',
    'Tire au hasard 1 membre humain de ce serveur via members.pickRandom (scope all). Réponds juste le nom tiré.',
    ['members.pickRandom'],
    async ({ entries }) => {
      const call = entries.find((e) => e.action === 'assistant.tool.members.pickRandom' && toolMeta(e).ok === true);
      const drawn = /Tirage parmi (\d+) candidat/u.exec(String(call ? toolMeta(call).summary ?? '' : ''));
      const count = drawn ? Number(drawn[1]) : 0;
      return { pass: count >= 1, note: count >= 1 ? `tirage parmi ${count} candidat(s) humain(s)` : 'aucun tirage réussi' };
    },
  );

  // ---- 3. Sondage COMPOSÉ complet : surface vote → votes → dépouille → édité ----
  if (!only || only.includes('polls.compose')) {
    await sleep(COOLDOWN_MS);
    // 3a. Surface avec 3 boutons vote (record.write component_votes, sans clôture).
    const watermarkA = new Date(Date.now() - 2_000);
    await send(
      `Crée une surface ici (surface.create, channelId = ${channelId}) : titre « E2E-features4 sondage », description « un vote par personne », 3 boutons Alpha, Beta, Gamma : chaque clic exécute record.write dans la collection component_votes avec choice = le label du bouton et messageId = celui de la surface. NE LA CLÔTURE PAS, crée juste la surface.`,
    );
    const entriesA = await waitQuiescent(watermarkA);
    const surfaceCreated = entriesA.some((e) => e.action === 'assistant.tool.surface.create' && toolMeta(e).ok === true);
    const messagesA = await rest(`/channels/${channelId}/messages?limit=10`);
    const panel = messagesA.find((m) => JSON.stringify(m.components || '').includes('E2E-features4 sondage'));
    if (!panel) {
      verdict('polls.compose', false, 'message de sondage introuvable');
    } else {
      // 3b. Deux votes écrits directement en base (le clic exige une vraie
      // interaction Discord, non simulable en REST) avec le messageId EXACT.
      const { createDatabaseClient } = await import('../src/modules/database/database-client.ts');
      const prismaVote = createDatabaseClient(process.env.DATABASE_URL);
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
      // 3c. Dépouillement par le bot (records.search + surface.patchState/updateComponent).
      const watermarkB = new Date(Date.now() - 2_000);
      await sleep(COOLDOWN_MS);
      await send(`Clôture le sondage du message id ${panel.id} : dépouille les votes de component_votes (records.search sur messageId), puis surface.patchState (state closed/résultats), puis AFFICHE les résultats dans la DESCRIPTION du message via surface.updateComponent (paramètre description, mentionne « Résultats » avec les counts Alpha/Beta), et désactive les 3 boutons (surface.updateComponent disabled).`);
      const entriesB = await waitQuiescent(watermarkB);
      const edited = await rest(`/channels/${channelId}/messages/${panel.id}`).catch(() => null);
      const editedOk = edited && JSON.stringify(edited.components || '').includes('Résultats');
      const countsOk = edited && /Alpha/.test(JSON.stringify(edited.components || '')) && /Beta/.test(JSON.stringify(edited.components || ''));
      const failedB = failedTools(entriesB);
      verdict(
        'polls.compose',
        surfaceCreated && Boolean(editedOk) && Boolean(countsOk),
        `${surfaceCreated ? 'surface créée' : 'surface.create sans succès'} ; ${editedOk ? 'message édité avec résultats' : 'pas de résultats'}${countsOk ? ' (choisis Alpha/Beta présents)' : ''}${failedB.length ? ` [tools en échec : ${failedB.join(' ; ')}]` : ''}`,
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
        const { createDatabaseClient } = await import('../src/modules/database/database-client.ts');
        const p = createDatabaseClient(process.env.DATABASE_URL);
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
      const { createDatabaseClient } = await import('../src/modules/database/database-client.ts');
      const p = createDatabaseClient(process.env.DATABASE_URL);
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
