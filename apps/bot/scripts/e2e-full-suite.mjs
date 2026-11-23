/**
 * SUITE E2E COMPLÈTE (E2) : 11 scénarios conversationnels réels via webhook
 * staff sur E2E_GUILD_ID, journalisés dans logs/e2e-suite-<guildId>.jsonl.
 *
 * 1. gate.noise        : bruit social ignoré (zéro LLM) même en salon dédié
 * 2. rules.list        : question règles → tool rules.list
 * 3. server.overview   : « montre ta configuration » → server.overview (PAS getConfig)
 * 4. config.panel      : panneau V2 posté dans le fil privé ⚙️┃config-bot
 * 5. tickets.surface   : panneau de tickets via surface.create (moteur générique)
 * 6. skills.voice      : recherche de recette « vocaux temporaires » (search_skills)
 * 7. skills.casino     : recherche de recette « casino » (135 blueprints)
 * 8. polls.compose     : sondage surface + votes DB + clôture avec résultats
 * 9. ingest.status     : état de l'ingestion historique (guild.ingestStatus)
 * 10. memory.forget    : opt-out mémoire (« oublie-moi ») + cleanup
 * 11. rule.confirm     : règle confirmDestructiveActions, une suppression demandée
 *                        à l'agent BLOQUÉE + surface ✅/❌ postée + salon intact
 *
 * STRICT : un tool ne compte que s'il a RÉUSSI (ok:true dans l'audit). Les
 * échecs de tools restent affichés dans la note de chaque scénario.
 *
 * Usage : node scripts/e2e-full-suite.mjs (E2E_ONLY=scenario filtrable)
 * Nettoyage en finally ; exit 1 si un scénario échoue.
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
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

const GUILD_ID = env.E2E_GUILD_ID;
const LOG_FILE = join(BOT_DIR, 'logs', `e2e-suite-${GUILD_ID}.jsonl`);
mkdirSync(join(BOT_DIR, 'logs'), { recursive: true });
// Append-only + runId : chaque exécution CUMULE le forensique (jamais tronqué).
const RUN_ID = new Date().toISOString().replace(/[:.]/gu, '-');
const journal = (event, data = {}) => {
  appendFileSync(LOG_FILE, `${JSON.stringify({ ts: new Date().toISOString(), runId: RUN_ID, event, ...data })}\n`, 'utf8');
};

async function rest(path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 140)}`);
  return body;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function prisma(fn) {
  const { PrismaClient } = await import('@prisma/client');
  const p = new PrismaClient();
  try {
    return await fn(p);
  } finally {
    await p.$disconnect();
  }
}

async function newAuditSince(since, actionPrefix = 'assistant.') {
  return prisma((p) =>
    p.auditLog.findMany({
      where: { createdAt: { gt: since }, action: { startsWith: actionPrefix } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, createdAt: true, metadata: true },
    }),
  );
}

async function waitQuiescent(watermark, { maxMs = 150_000, quietMs = 8_000 } = {}) {
  const start = Date.now();
  let entries = [];
  let lastChange = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(4_000);
    entries = await newAuditSince(watermark);
    if (entries.length > 0) lastChange = Date.now();
    const hasTool = entries.some((e) => e.action.startsWith('assistant.tool.') || e.action === 'assistant.reply');
    if (Date.now() - lastChange >= quietMs && hasTool) break;
  }
  return entries;
}

async function main() {
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',').map((s) => s.trim()) : null;
  console.log(`[E2E-suite] démarrage ${new Date().toISOString()} (guild ${GUILD_ID})`);
  journal('suite_start', { guildId: GUILD_ID });

  const me = await rest('/users/@me');
  const guilds = await rest('/users/@me/guilds');
  if (!guilds.some((g) => g.id === GUILD_ID)) {
    console.error(`[FAIL] bot absent de ${GUILD_ID}`);
    process.exit(1);
  }

  let channelId;
  try {
    const g = await prisma((p) => p.guild.findUnique({ where: { id: GUILD_ID }, select: { settings: true } }));
    channelId = g?.settings ? JSON.parse(g.settings)?.assistant?.channelId ?? null : null;
  } catch {
    channelId = null;
  }
  if (!channelId) throw new Error('aucun salon dédié IA configuré');

  const hooks = await rest(`/channels/${channelId}/webhooks`);
  let hook = hooks.find((h) => h.name === WEBHOOK_NAME && h.user?.id === me.id);
  if (!hook) hook = await rest(`/channels/${channelId}/webhooks`, { method: 'POST', body: JSON.stringify({ name: WEBHOOK_NAME }) });
  const send = (content) =>
    rest(`/webhooks/${hook.id}/${hook.token}?wait=true`, {
      method: 'POST',
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
  const webhookUserId = hook.id;

  const results = [];
  const verdict = (name, pass, note = '') => {
    results.push({ name, pass });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${note ? ` : ${note}` : ''}`);
    journal('verdict', { scenario: name, pass, note });
  };

  /** Scénario conversationnel : envoie un prompt, attend la fin, check. */
  const scenario = async (name, prompt, check, { expectQuiet = false } = {}) => {
    if (only && !only.includes(name)) return;
    if (prompt === null) return; // scénario remplacé par un flux dédié plus bas
    const watermark = new Date(Date.now() - 2_000);
    await sleep(COOLDOWN_MS);
    journal('scenario_start', { scenario: name });
    await send(prompt);
    let entries = [];
    if (expectQuiet) {
      // Anti-bruit : on attend un peu et on vérifie qu'aucun traitement n'a eu lieu.
      await sleep(25_000);
      entries = await newAuditSince(watermark);
    } else {
      entries = await waitQuiescent(watermark);
    }
    let pass = false;
    let note = '';
    try {
      const out = await check({ entries, watermark });
      pass = out.pass;
      note = out.note ?? '';
    } catch (error) {
      pass = false;
      note = `check error: ${error.message.slice(0, 120)}`;
    }
    // Les tools en échec restent VISIBLES même quand le scénario passe (un
    // échec retenté avec succès est une auto-correction, pas un PASS propre).
    const failed = failedTools(entries);
    if (failed.length > 0) note += ` [tools en échec : ${failed.join(' ; ')}]`;
    journal('scenario_tools', {
      scenario: name,
      actions: entries.filter((e) => e.action.startsWith('assistant.tool.')).map((e) => `${e.action.replace('assistant.tool.', '')}${toolMeta(e).ok === true ? '' : '(échec)'}`),
    });
    verdict(name, pass, note);
  };

  /**
   * Un tool ne compte que s'il a RÉUSSI. La première version de cette suite ne
   * regardait que le NOM : config.panel, server.overview et les surface.create
   * de tickets ont ainsi été comptés PASS alors que chacun de leurs appels
   * avait échoué.
   */
  const toolMeta = (entry) => {
    try {
      return JSON.parse(entry.metadata ?? '{}');
    } catch {
      return {};
    }
  };
  const ranTool = (entries, action) => entries.some((e) => e.action === `assistant.tool.${action}` && toolMeta(e).ok === true);
  const failedTools = (entries) =>
    entries
      .filter((e) => e.action.startsWith('assistant.tool.') && toolMeta(e).ok !== true)
      .map((e) => `${e.action.replace('assistant.tool.', '')} (${String(toolMeta(e).summary ?? 'sans motif').slice(0, 90)})`);

  // ---- 1. Anti-bruit : pur bruit social ignoré (zéro LLM) ----
  await scenario(
    'gate.noise',
    'HAHAHAHYA QUOI',
    async ({ entries }) => {
      const processed = entries.some((e) => e.action === 'assistant.reply' || e.action.startsWith('assistant.tool.'));
      return { pass: !processed, note: processed ? 'traité à tort (bruit social)' : 'ignoré, zéro appel LLM' };
    },
    { expectQuiet: true },
  );

  // ---- 2. Règles serveur : rules.list ----
  await scenario('rules.list', 'Quelles sont les règles de comportement de ce serveur actuellement ?', async ({ entries }) => {
    const ok = ranTool(entries, 'rules.list') || ranTool(entries, 'server.overview');
    return { pass: ok, note: ok ? 'règles lues via le store GuildRule' : 'rules.list/server.overview manquant' };
  });

  // ---- 3. Vue configuration : server.overview (PAS getConfig legacy) ----
  await scenario('server.overview', 'Montre-moi ta configuration : ce que tu as activé sur ce serveur.', async ({ entries }) => {
    const good = ranTool(entries, 'server.overview') || ranTool(entries, 'config.panel');
    const legacyDump = entries.some((e) => e.action === 'assistant.tool.getConfig' && String(e.metadata).length > 400);
    return { pass: good && !legacyDump, note: good ? 'vue appliquée (règles/skills/intégrations)' : 'ni server.overview ni config.panel' };
  });

  // ---- 4. Panneau V2 dans le fil privé config-bot ----
  // Trois preuves : le tool a réussi, le fil est bien PRIVÉ, et un panneau du
  // bot y a réellement été posté (le fil seul ne prouve rien : il avait été
  // créé par un appel qui avait ensuite planté avant de poster quoi que ce soit).
  await scenario('config.panel', 'Ouvre le panneau de configuration dans le fil privé config-bot.', async ({ entries }) => {
    const called = ranTool(entries, 'config.panel');
    const row = await prisma((p) => p.guildAgentSettings.findUnique({ where: { guildId: GUILD_ID } }));
    if (!row?.configThreadId) return { pass: false, note: 'aucun fil config-bot en base' };
    const channel = await rest(`/channels/${row.configThreadId}`).catch(() => null);
    // 12 = PRIVATE_THREAD (Discord).
    const privateThread = channel?.type === 12 && String(channel.name ?? '').includes('config-bot');
    const messages = await rest(`/channels/${row.configThreadId}/messages?limit=5`).catch(() => []);
    const posted = messages.some((m) => m.author?.id === me.id && Array.isArray(m.components) && m.components.length > 0);
    return {
      pass: called && Boolean(privateThread) && posted,
      note: `tool ${called ? 'réussi' : 'en échec'} · fil ${privateThread ? 'privé' : 'introuvable ou non privé'} · panneau ${posted ? 'posté' : 'absent'}`,
    };
  });

  // ---- 5. Tickets par le moteur générique ----
  // La surface doit avoir été créée PENDANT ce scénario (l'ancien contrôle
  // acceptait une surface restée d'un run précédent).
  await scenario('tickets.surface', 'Crée ici un panneau de tickets simple : un bouton « Support » qui ouvrira un salon privé au demandeur (surface.create, kind ticket).', async ({ entries, watermark }) => {
    const createdId = entries
      .filter((e) => e.action === 'assistant.tool.surface.create' && toolMeta(e).ok === true)
      .map((e) => /surfaceId ([a-z0-9]+)/u.exec(String(toolMeta(e).summary ?? ''))?.[1])
      .find(Boolean);
    const row = createdId ? await prisma((p) => p.interactiveSurface.findUnique({ where: { id: createdId } })) : null;
    const fresh = Boolean(row && row.guildId === GUILD_ID && row.createdAt > watermark);
    return { pass: fresh, note: fresh ? `surface « ${row.kind} » ${createdId.slice(-6)} créée pendant le scénario` : 'aucune surface créée avec succès pendant le scénario' };
  });

  // ---- 6. Recette vocaux temporaires ----
  await scenario('skills.voice', 'Mets en place des salons vocaux temporaires automatiques (cherche d\u0027abord la recette dans ta bibliothèque search_skills).', async ({ entries }) => {
    const ok = ranTool(entries, 'search_skills') || ranTool(entries, 'blueprints.list');
    return { pass: ok, note: ok ? 'bibliothèque de recettes consultée (135 blueprints)' : 'search_skills manquant' };
  });

  // ---- 7. Recette casino ----
  await scenario('skills.casino', 'Mets un casino avec des pièces et un blackjack sur le serveur (cherche d\u0027abord la recette dans ta bibliothèque search_skills).', async ({ entries }) => {
    const ok = ranTool(entries, 'search_skills') || ranTool(entries, 'blueprints.list');
    return { pass: ok, note: ok ? 'recette casino trouvée au catalogue' : 'search_skills manquant' };
  });

  // (8. polls.compose est un flux dédié en plusieurs étapes, plus bas.)

  // ---- 9. Statut ingestion ----
  await scenario('ingest.status', 'Où en est l\u0027ingestion de l\u0027historique du serveur ?', async ({ entries }) => {
    const ok = ranTool(entries, 'guild.ingestStatus') || ranTool(entries, 'guild.ingestHistory');
    return { pass: ok, note: ok ? 'statut ingestion consulté' : 'guild.ingestStatus manquant' };
  });

  // ---- 10. Opt-out mémoire ----
  await scenario('memory.forget', 'Oublie-moi totalement : supprime tout ce que tu sais de moi et ne m\u0027enregistre plus jamais.', async ({ entries }) => {
    const ok = ranTool(entries, 'memory.forget');
    const row = await prisma((p) => p.memoryOptOut.findFirst({ where: { guildId: GUILD_ID } }));
    return { pass: ok && Boolean(row), note: ok && row ? 'opt-out posé (purge + blocage futur)' : 'memory.forget ou opt-out manquant' };
  });

  // ---- 8bis. Sondage détaillé (le vrai flux) ----
  if (!only || only.includes('polls.compose')) {
    journal('scenario_start', { scenario: 'polls.compose' });
    const watermarkA = new Date(Date.now() - 2_000);
    await sleep(COOLDOWN_MS);
    await send(`Crée une surface ici (surface.create, channelId = ${channelId}) : titre « E2E-suite sondage », 3 boutons Alpha, Beta, Gamma (clic = record.write component_votes choice=label). NE LA CLÔTURE PAS.`);
    const entriesA = await waitQuiescent(watermarkA);
    const surfaceCreated = ranTool(entriesA, 'surface.create');
    const messagesA = await rest(`/channels/${channelId}/messages?limit=10`);
    const panel = messagesA.find((m) => JSON.stringify(m.components || '').includes('E2E-suite sondage'));
    if (!panel) {
      verdict('polls.compose', false, 'message de sondage introuvable');
    } else {
      await prisma((p) =>
        p.agentRecord.createMany({
          data: [
            { guildId: GUILD_ID, collection: 'component_votes', channelId, messageId: panel.id, createdBy: '111111111111111111', data: JSON.stringify({ version: 1, messageId: panel.id, channelId, choice: 'Alpha' }) },
            { guildId: GUILD_ID, collection: 'component_votes', channelId, messageId: panel.id, createdBy: '222222222222222222', data: JSON.stringify({ version: 1, messageId: panel.id, channelId, choice: 'Beta' }) },
          ],
        }),
      );
      const watermarkB = new Date(Date.now() - 2_000);
      await sleep(COOLDOWN_MS);
      await send(`Clôture le sondage du message id ${panel.id} : records.search des votes, surface.patchState (résultats), description mise à jour avec « Résultats » et les counts, boutons désactivés.`);
      const entriesB = await waitQuiescent(watermarkB);
      const edited = await rest(`/channels/${channelId}/messages/${panel.id}`).catch(() => null);
      const editedOk = edited && JSON.stringify(edited.components || '').includes('Résultats');
      verdict(
        'polls.compose',
        surfaceCreated && Boolean(editedOk),
        `${surfaceCreated ? 'surface créée' : 'surface.create en échec'} ; ${editedOk ? 'résultats affichés' : 'pas de résultats'}`,
      );
      await rest(`/channels/${channelId}/messages/${panel.id}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  // ---- 11. Confirmation destructive (règle serveur) ----
  // Avec confirmDestructiveActions, une suppression demandée à l'agent doit
  // être BLOQUÉE et une surface ✅/❌ postée. Ces liaisons vivaient dans des
  // classes de module que le framework n'instancie jamais : zéro confirmation
  // n'avait jamais été affichée. Le clic ✅ exige une vraie interaction Discord
  // (non simulable en REST) : il est couvert par tool-registry.confirm.spec.ts.
  if (!only || only.includes('rule.confirm')) {
    journal('scenario_start', { scenario: 'rule.confirm' });
    const probe = await rest(`/guilds/${GUILD_ID}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name: 'e2e-confirm-probe', type: 0 }),
    });
    let ruleOn = false;
    try {
      // a. Active la règle PAR LE BOT : son cache des règles est invalidé au passage.
      await sleep(COOLDOWN_MS);
      let watermark = new Date(Date.now() - 2_000);
      await send('Active la règle de confirmation des actions destructives sur ce serveur (rules.set, confirmDestructiveActions true). Réponds juste fait.');
      let entries = await waitQuiescent(watermark);
      const ruleRow = await prisma((p) => p.guildRule.findUnique({ where: { guildId: GUILD_ID } }));
      ruleOn = ranTool(entries, 'rules.set') && ruleRow?.confirmDestructiveActions === true;

      // b. Demande une suppression : bloquée, avec confirmation affichée, salon intact.
      await sleep(COOLDOWN_MS);
      watermark = new Date(Date.now() - 2_000);
      await send(`Supprime le salon « e2e-confirm-probe » (id ${probe.id}) avec deleteChannel. Réponds juste fait.`);
      entries = await waitQuiescent(watermark);
      const attempts = entries.filter((e) => ['assistant.tool.deleteChannel', 'assistant.tool.channel.remove'].includes(e.action));
      const blocked = attempts.length > 0 && attempts.every((e) => toolMeta(e).ok !== true && /bloquée par la règle/u.test(String(toolMeta(e).summary ?? '')));
      const shown = await prisma((p) => p.auditLog.count({ where: { guildId: GUILD_ID, action: 'rule.confirm.shown', createdAt: { gt: watermark } } }));
      const stillThere = await rest(`/channels/${probe.id}`).then(() => true).catch(() => false);
      const failures = failedTools(entries).filter((line) => !line.startsWith('deleteChannel (') && !line.startsWith('channel.remove ('));
      verdict(
        'rule.confirm',
        ruleOn && blocked && shown > 0 && stillThere,
        `règle ${ruleOn ? 'activée' : 'NON activée'} · ${attempts.length} tentative(s) ${blocked ? 'bloquée(s)' : 'NON bloquée(s)'} · confirmations affichées : ${shown} · salon ${stillThere ? 'intact' : 'SUPPRIMÉ'}${failures.length ? ` [tools en échec : ${failures.join(' ; ')}]` : ''}`,
      );
    } finally {
      await rest(`/channels/${probe.id}`, { method: 'DELETE' }).catch(() => {});
      // c. Rétablit la règle : par le bot (cache cohérent), sinon en base + expiration du cache.
      const current = await prisma((p) => p.guildRule.findUnique({ where: { guildId: GUILD_ID } }));
      if (current?.confirmDestructiveActions === true) {
        await sleep(COOLDOWN_MS);
        await send('Désactive la règle de confirmation des actions destructives sur ce serveur (rules.set, confirmDestructiveActions false). Réponds juste fait.').catch(() => {});
        await waitQuiescent(new Date(Date.now() - 2_000)).catch(() => []);
        const after = await prisma((p) => p.guildRule.findUnique({ where: { guildId: GUILD_ID } }));
        if (after?.confirmDestructiveActions === true) {
          await prisma((p) => p.guildRule.update({ where: { guildId: GUILD_ID }, data: { confirmDestructiveActions: false } }));
          console.log('[CLEANUP] règle rétablie directement en base ; le cache des règles expire dans 60 s.');
          await sleep(65_000);
        }
      }
    }
  }

  // ---- CLEANUP ----
  console.log('[CLEANUP]...');
  try {
    await prisma((p) => p.memoryOptOut.deleteMany({ where: { guildId: GUILD_ID } }));
    await prisma((p) => p.agentRecord.deleteMany({ where: { guildId: GUILD_ID, collection: 'component_votes', createdBy: { in: ['111111111111111111', '222222222222222222'] } } }));
    // Surfaces de test (titre « E2E ») et surfaces de confirmation : message + ligne.
    const stale = await prisma((p) =>
      p.interactiveSurface.findMany({
        where: { guildId: GUILD_ID, OR: [{ kind: 'confirm' }, { definition: { contains: 'E2E' } }] },
        select: { id: true, messageId: true, channelId: true },
      }),
    );
    for (const surface of stale) {
      if (surface.messageId) await rest(`/channels/${surface.channelId}/messages/${surface.messageId}`, { method: 'DELETE' }).catch(() => {});
      await prisma((p) => p.interactiveSurface.deleteMany({ where: { id: surface.id } }));
    }
    journal('cleanup', { scope: 'memory_opt_out + test votes + surfaces de test', surfaces: stale.length });
  } catch (error) {
    journal('cleanup_error', { error: error.message.slice(0, 120) });
  }

  const passCount = results.filter((r) => r.pass).length;
  console.log(`[SUMMARY] ${passCount}/${results.length} PASS`);
  journal('suite_end', { pass: passCount, total: results.length });
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((error) => {
  console.error('[FAIL]', error.message);
  journal('suite_fatal', { error: error.message.slice(0, 200) });
  process.exit(1);
});
