/**
 * SUITE E2E COMPLÈTE (E2) : 13 scénarios conversationnels réels via webhook
 * staff sur E2E_GUILD_ID, journalisés dans logs/e2e-suite-<guildId>.jsonl.
 *
 * 1. gate.noise        : bruit social ignoré (zéro LLM) même en salon dédié
 * 2. rules.list        : question règles → tool rules.list
 * 3. server.overview   : « montre ta configuration » → server.overview (PAS getConfig)
 * 4. config.panel      : panneau V2 posté dans le fil privé ⚙️┃config-bot
 * 5. tickets.surface   : panneau de tickets via surface.create (moteur générique)
 *                        en moins de TICKETS_MAX_TURNS tours LLM, surface supprimée
 * 6. skills.voice      : recherche de recette « vocaux temporaires » (search_skills)
 * 7. skills.casino     : recherche de recette « casino » (135 blueprints)
 * 8. polls.compose     : sondage surface + votes DB + clôture avec résultats
 * 9. ingest.status     : état de l'ingestion historique (guild.ingestStatus)
 * 10. memory.forget    : opt-out mémoire (« oublie-moi ») + cleanup
 * 11. rule.confirm     : règle « Confirmer les actions (hors lecture) » : une
 *                        suppression ET un renommage demandés à l'agent sont
 *                        BLOQUÉS (un plan ✅/❌ posté par demande, en fin de
 *                        réponse, rien exécuté sans clic), une lecture passe
 * 12. records.dynamic  : une recette écrit dans une collection dynamique
 *                        (casino_balance), ligne vérifiée en base puis supprimée
 * 13. surface.blackjack: rejoue la demande « blackjack » de l'incident du 23/11
 *                        20:09 : aucune surface « probe », aucune fuite de
 *                        balises internes, boutons câblés, plafond non atteint
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
/**
 * Budget de tours LLM d'un montage simple. Le 23/11, les primitives étaient
 * derrière search_tools : le modèle a recherché 8 fois sans jamais appeler
 * surface.create et buté sur le plafond de 12 tours de la boucle.
 */
const TICKETS_MAX_TURNS = 5;

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

const GUILD_ID = env.E2E_GUILD_ID;
const LOG_FILE = join(BOT_DIR, 'logs', `e2e-suite-${GUILD_ID}.jsonl`);
/** Journal d'usage du LLM : une ligne par tour de la boucle de l'agent. */
const LLM_LOG = join(BOT_DIR, 'logs', 'llm.jsonl');
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
  const { createDatabaseClient } = await import('../src/modules/database/database-client.ts');
  const p = createDatabaseClient(process.env.DATABASE_URL);
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

/**
 * Fenêtre de la demande d'un scénario sur le serveur testé : instant du
 * routage de ses tools (tools.selected) et instant de sa réponse.
 */
function requestWindow(watermark) {
  return prisma((p) =>
    p.auditLog.findMany({
      where: { guildId: GUILD_ID, createdAt: { gt: watermark }, action: { in: ['tools.selected', 'assistant.reply', 'assistant.error'] } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, createdAt: true },
    }),
  );
}

/**
 * Tours LLM de la demande : lignes du journal d'usage écrites entre le
 * routage des tools et la réponse. Ce journal ne porte pas l'identifiant de
 * la demande, c'est la fenêtre temporelle qui la délimite.
 */
function llmTurns(window) {
  const selected = window.find((e) => e.action === 'tools.selected');
  const reply = window.find((e) => e.action === 'assistant.reply' || e.action === 'assistant.error');
  if (!selected || !reply) return null;
  let lines;
  try {
    lines = readFileSync(LLM_LOG, 'utf8').split(/\r?\n/u).filter(Boolean);
  } catch {
    return null;
  }
  const from = selected.createdAt.toISOString();
  const to = reply.createdAt.toISOString();
  return lines.flatMap((line) => {
    try {
      const row = JSON.parse(line);
      return row.cause === 'reply' && row.ts >= from && row.ts <= to ? [row] : [];
    } catch {
      return [];
    }
  });
}

/** Résumé des tours d'une demande : leur nombre et la capacité de conversation qui les a servis. */
const turnsLabel = (turns) => {
  if (!turns) return 'tours LLM : inconnus';
  const capabilities = [...new Set(turns.map((turn) => turn.capability).filter(Boolean))];
  return `${turns.length} tour(s) LLM sur ${capabilities.join(', ') || 'capacité inconnue'}`;
};

/**
 * Attend la fin du traitement d'une demande : une réponse (ou une erreur) est
 * audible dans l'audit ET plus aucune entrée n'apparaît pendant quietMs.
 * La première version recalculait l'instant du dernier changement à chaque
 * sondage dès qu'une entrée existait : chaque scénario attendait les 150 s
 * maximales, même quand le bot avait répondu en 5 s.
 */
async function waitQuiescent(watermark, { maxMs = 150_000, quietMs = 5_000 } = {}) {
  const start = Date.now();
  let entries = [];
  let lastCount = -1;
  let lastChange = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(4_000);
    entries = await newAuditSince(watermark);
    if (entries.length !== lastCount) {
      lastCount = entries.length;
      lastChange = Date.now();
    }
    const answered = entries.some((e) => e.action === 'assistant.reply' || e.action === 'assistant.error');
    if (answered && Date.now() - lastChange >= quietMs) break;
  }
  return entries;
}

async function main() {
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',').map((s) => s.trim()) : null;
  console.log(`[E2E-suite] démarrage ${new Date().toISOString()} (guild ${GUILD_ID})`);
  // Le filtre figure sur la première ligne du journal : un rig lancé sans
  // E2E_ONLY rejoue toute la suite (24/11, récidive).
  journal('suite_start', { guildId: GUILD_ID, only });

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

  /** Messages du bot dans le salon dédié depuis la marque horaire d'un scénario. */
  const botMessagesSince = async (watermark) => {
    const messages = await rest(`/channels/${channelId}/messages?limit=50`).catch(() => []);
    return messages.filter((message) => message.author?.id === me.id && Date.parse(message.timestamp) > watermark.getTime());
  };
  const messageText = (message) => `${message.content ?? ''} ${JSON.stringify(message.components ?? '')}`;

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
    const turns = expectQuiet ? null : llmTurns(await requestWindow(watermark).catch(() => []));
    let pass = false;
    let note = '';
    try {
      const out = await check({ entries, watermark, turns });
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
    if (turns) note += ` [${turnsLabel(turns)}]`;
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
  // acceptait une surface restée d'un run précédent), et SANS chercher : le
  // 23/11 les primitives étaient derrière search_tools et le modèle a
  // recherché 8 fois sans jamais les appeler (plafond de 12 tours atteint).
  // Elle est ensuite supprimée : rien ne reste sur le serveur.
  await scenario('tickets.surface', 'Crée ici un panneau de tickets simple : un bouton « Support » qui ouvrira un salon privé au demandeur (surface.create, kind ticket).', async ({ entries, watermark, turns }) => {
    const createdId = entries
      .filter((e) => e.action === 'assistant.tool.surface.create' && toolMeta(e).ok === true)
      .map((e) => /surfaceId ([a-z0-9]+)/u.exec(String(toolMeta(e).summary ?? ''))?.[1])
      .find(Boolean);
    const row = createdId ? await prisma((p) => p.interactiveSurface.findUnique({ where: { id: createdId } })) : null;
    const fresh = Boolean(row && row.guildId === GUILD_ID && row.createdAt > watermark);
    const ceiling = fresh ? (await botMessagesSince(watermark)).some((message) => messageText(message).includes("Limite d'étapes atteinte")) : false;
    // Un runTool range le résultat à plat ({{steps.N.channelId}}) : une référence
    // {{steps.N.data.x}} résout vide et le bouton casse au clic, invisible au rig.
    const badRefs = row ? (JSON.stringify(JSON.parse(row.definition)).match(/steps\.\d+\.data\./gu)?.length ?? 0) : 0;
    // Restaure : ni le panneau, ni sa ligne, ni l'entrée de mémoire écrite à son sujet.
    let removed = false;
    let forgotten = 0;
    if (fresh) {
      if (row.messageId) await rest(`/channels/${row.channelId}/messages/${row.messageId}`, { method: 'DELETE' }).catch(() => {});
      await prisma((p) => p.interactiveSurface.deleteMany({ where: { id: row.id } }));
      removed = (await prisma((p) => p.interactiveSurface.findUnique({ where: { id: row.id } }))) === null;
      forgotten = await prisma((p) => p.guildMemory.deleteMany({ where: { guildId: GUILD_ID, createdAt: { gt: watermark }, content: { contains: row.id } } }))
        .then((out) => out.count)
        .catch(() => 0);
    }
    const count = turns?.length ?? null;
    const searches = entries.filter((e) => e.action === 'assistant.tool.search_tools').length;
    const budget = count === null ? 'tours LLM : inconnus' : `${count} tour(s) LLM sur un budget de ${TICKETS_MAX_TURNS}`;
    const pass = fresh && count !== null && count < TICKETS_MAX_TURNS && !ceiling && removed && badRefs === 0;
    return {
      pass,
      note:
        `${fresh ? `surface « ${row.kind} » ${createdId.slice(-6)} créée pendant le scénario` : 'aucune surface créée avec succès pendant le scénario'}` +
        ` · ${budget} · ${searches} search_tools${ceiling ? " · plafond d'étapes atteint" : ''}${badRefs > 0 ? ` · ${badRefs} référence(s) de résultat inconnue(s) (steps.N.data)` : ' · références de résultat valides'}` +
        ` · ${fresh ? (removed ? `surface de test supprimée, ${forgotten} entrée(s) de mémoire retirée(s)` : 'surface de test NON supprimée') : 'rien à supprimer'}`,
    };
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

  // ---- 11. Confirmer les actions (hors lecture) : règle serveur ----
  // Avec confirmDestructiveActions, tout ce que le modèle propose et qui
  // modifie attend le clic du demandeur : un plan ✅/❌ est posté en fin de
  // réponse et rien n'est exécuté. Un outil non signalé destructif attend
  // comme un autre ; une lecture passe. Ces liaisons vivaient dans des
  // classes de module que le framework n'instancie jamais : zéro confirmation
  // n'avait jamais été affichée. Le clic ✅ exige une vraie interaction Discord
  // (non simulable en REST) : il est couvert par tool-registry.confirm.spec.ts.
  if (!only || only.includes('rule.confirm')) {
    journal('scenario_start', { scenario: 'rule.confirm' });
    const probe = await rest(`/guilds/${GUILD_ID}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name: 'e2e-confirm-probe', type: 0 }),
    });
    const scenarioStart = new Date(Date.now() - 2_000);
    const PROBE = 'e2e-confirm-probe';
    /** Textes et identifiants de boutons du panneau d'un plan, lus sur le message réel. */
    const panelOf = async (row) => {
      if (!row?.messageId) return { texts: [], buttons: [] };
      return rest(`/channels/${channelId}/messages/${row.messageId}`)
        .then((message) => ({
          texts: (message.components ?? []).flatMap((block) => (block.components ?? [])).filter((part) => part.type === 10).map((part) => part.content ?? ''),
          buttons: JSON.stringify(message.components ?? []).match(/plan:(?:apply|cancel)~p=[a-z0-9]+/g) ?? [],
        }))
        .catch(() => ({ texts: [], buttons: [] }));
    };
    const actionsOf = (row) => {
      try {
        return JSON.parse(row.state).actions ?? [];
      } catch {
        return [];
      }
    };
    let ruleOn = false;
    try {
      // a. Active la règle PAR LE BOT : son cache des règles est invalidé au passage.
      await sleep(COOLDOWN_MS);
      let watermark = new Date(Date.now() - 2_000);
      await send('Active la règle « Confirmer les actions (hors lecture) » sur ce serveur (rules.set, confirmDestructiveActions true). Réponds juste fait.');
      let entries = await waitQuiescent(watermark);
      const ruleRow = await prisma((p) => p.guildRule.findUnique({ where: { guildId: GUILD_ID } }));
      ruleOn = ranTool(entries, 'rules.set') && ruleRow?.confirmDestructiveActions === true;

      // b. Demande une suppression : bloquée, avec confirmation affichée, salon intact.
      await sleep(COOLDOWN_MS);
      watermark = new Date(Date.now() - 2_000);
      await send(`Supprime le salon « ${PROBE} » (id ${probe.id}) avec deleteChannel. Réponds juste fait.`);
      entries = await waitQuiescent(watermark);
      const attempts = entries.filter((e) => ['assistant.tool.deleteChannel', 'assistant.tool.channel.remove'].includes(e.action));
      const heldByRule = (list) => list.length > 0 && list.every((e) => toolMeta(e).ok !== true && /bloquée par la règle/u.test(String(toolMeta(e).summary ?? '')));
      const blocked = heldByRule(attempts);
      const shown = await prisma((p) => p.auditLog.count({ where: { guildId: GUILD_ID, action: 'rule.confirm.shown', createdAt: { gt: watermark } } }));
      const stillThere = await rest(`/channels/${probe.id}`).then(() => true).catch(() => false);
      const failures = failedTools(entries).filter((line) => !line.startsWith('deleteChannel (') && !line.startsWith('channel.remove ('));

      // c. Un outil qui modifie SANS être signalé destructif attend lui aussi :
      //    le renommage est bloqué et le nom du salon ne change pas.
      await sleep(COOLDOWN_MS);
      watermark = new Date(Date.now() - 2_000);
      await send(`Renomme le salon « ${PROBE} » (id ${probe.id}) en « ${PROBE}-2 » avec renameChannel. Réponds juste fait.`);
      entries = await waitQuiescent(watermark);
      const renameEntries = entries.filter((e) => e.action === 'assistant.tool.renameChannel');
      const renameHeld = heldByRule(renameEntries);
      const nameUntouched = await rest(`/channels/${probe.id}`).then((channel) => channel.name === PROBE).catch(() => false);
      const renameFailures = failedTools(entries).filter((line) => !line.startsWith('renameChannel ('));

      // d. Une lecture passe sans attendre : la règle est « hors lecture ».
      await sleep(COOLDOWN_MS);
      watermark = new Date(Date.now() - 2_000);
      await send('Donne les informations du serveur avec getServerInfo. Réponds juste fait.');
      entries = await waitQuiescent(watermark);
      const readRan = ranTool(entries, 'getServerInfo');
      const readFailures = failedTools(entries);

      // e. Les plans : un par demande d'action, affichés en fin de réponse, deux boutons,
      //    rien d'exécuté sans clic. Le premier porte le titre de la règle et le résumé du modèle.
      let plans = [];
      for (let attempt = 0; attempt < 6 && plans.length < 2; attempt += 1) {
        plans = await prisma((p) => p.interactiveSurface.findMany({ where: { guildId: GUILD_ID, kind: { startsWith: 'action-plan' }, createdAt: { gt: scenarioStart } }, orderBy: { createdAt: 'asc' } }));
        if (plans.length < 2) await sleep(3_000);
      }
      const deletionPlan = plans.find((row) => actionsOf(row).some((action) => action.tool === 'deleteChannel' && String(action.input?.channelId ?? '') === probe.id));
      const planHoldsDeletion = Boolean(deletionPlan);
      const planHoldsRename = plans.some((row) => actionsOf(row).some((action) => action.tool === 'renameChannel' && String(action.input?.channelId ?? '') === probe.id));
      const planPosted = await prisma((p) => p.auditLog.count({ where: { guildId: GUILD_ID, action: 'plan.posted', createdAt: { gt: scenarioStart } } }));
      const planRejected = await prisma((p) => p.auditLog.count({ where: { guildId: GUILD_ID, action: 'plan.rejected', createdAt: { gt: scenarioStart } } }));
      const planExecuted = await prisma((p) => p.auditLog.count({ where: { guildId: GUILD_ID, action: { in: ['plan.executed', 'plan.interrupted'] }, createdAt: { gt: scenarioStart } } }));
      const panel = await panelOf(deletionPlan);
      const planButtons = panel.buttons;
      // Titre, ligne du demandeur, résumé, action, pied : cinq textes quand le modèle a écrit le résumé.
      const panelTitled = panel.texts[0] === '## Confirmer les actions (hors lecture)';
      const summaryPresent = panel.texts.length === 5 && !panel.texts[2].startsWith('1. **');
      // Les tools en échec restent VISIBLES même quand le scénario passe ; les actions mises en
      // attente par la règle sont le sujet du scénario, pas des échecs.
      const allFailures = [...failures, ...renameFailures, ...readFailures];
      journal('scenario_tools', {
        scenario: 'rule.confirm',
        failed: allFailures,
        held: [...attempts, ...renameEntries].map((e) => e.action.replace('assistant.tool.', '')),
      });
      verdict(
        'rule.confirm',
        ruleOn && blocked && shown > 0 && stillThere && planHoldsDeletion && planHoldsRename && planPosted === 2 && planRejected === 0 && planButtons.length === 2 && panelTitled && summaryPresent && planExecuted === 0 && renameHeld && nameUntouched && readRan,
        `règle ${ruleOn ? 'activée' : 'NON activée'} · suppression ${attempts.length} tentative(s) ${blocked ? 'bloquée(s)' : 'NON bloquée(s)'}, salon ${stillThere ? 'intact' : 'SUPPRIMÉ'} · renommage ${renameHeld ? 'bloqué' : 'NON bloqué'}, nom ${nameUntouched ? 'inchangé' : 'CHANGÉ'} · lecture getServerInfo ${readRan ? 'exécutée' : 'NON exécutée'} · plans ${plans.length} (suppression ${planHoldsDeletion ? 'constituée' : 'ABSENTE'}, renommage ${planHoldsRename ? 'constitué' : 'ABSENT'}), postés : ${planPosted}, rejetés : ${planRejected} · panneau : titre ${panelTitled ? 'ok' : 'FAUX'}, résumé du modèle ${summaryPresent ? 'présent' : 'ABSENT'}, ${planButtons.length}/2 bouton(s) · exécutions : ${planExecuted}${allFailures.length ? ` [tools en échec : ${allFailures.join(' ; ')}]` : ''}`,
      );
    } finally {
      await rest(`/channels/${probe.id}`, { method: 'DELETE' }).catch(() => {});
      // Les plans de ce scénario, leurs panneaux et leurs lignes, plus ceux qu'une exécution
      // précédente aurait laissés en attente : sinon ils expirent avec leurs boutons encore visibles.
      const plans = await prisma((p) =>
        p.interactiveSurface.findMany({ where: { guildId: GUILD_ID, kind: { startsWith: 'action-plan' }, OR: [{ createdAt: { gt: scenarioStart } }, { kind: 'action-plan' }] } }),
      ).catch(() => []);
      for (const row of plans) {
        if (row.messageId) await rest(`/channels/${row.channelId}/messages/${row.messageId}`, { method: 'DELETE' }).catch(() => {});
      }
      if (plans.length > 0) await prisma((p) => p.interactiveSurface.deleteMany({ where: { id: { in: plans.map((row) => row.id) } } })).catch(() => {});
      // Rétablit la règle. Tant qu'elle est active, demander au bot de la désactiver serait
      // lui-même une action mise en attente : la base est écrite directement, puis le cache
      // des règles du bot expire (60 s).
      const current = await prisma((p) => p.guildRule.findUnique({ where: { guildId: GUILD_ID } }));
      if (current?.confirmDestructiveActions === true) {
        await prisma((p) => p.guildRule.update({ where: { guildId: GUILD_ID }, data: { confirmDestructiveActions: false } }));
        console.log('[CLEANUP] règle rétablie en base ; le cache des règles expire dans 60 s.');
        await sleep(65_000);
      }
    }
  }

  // ---- 12. Collection dynamique : une recette écrit dans casino_balance ----
  // Les recettes de la bibliothèque utilisent des collections absentes du
  // registre natif (casino_balance, giveaway_entries...) : le store les accepte
  // à la demande depuis le 23/11 au soir. On applique la PREMIÈRE étape de la
  // recette du casino (le solde de départ) et on vérifie la ligne en base.
  await scenario(
    'records.dynamic',
    'Applique uniquement la première étape de la recette de casino (cherche-la avec search_skills) : crée mon solde de départ dans la collection casino_balance avec records.create (userId = mon id, balance = 100). Réponds juste fait.',
    async ({ entries, watermark }) => {
      const created = ranTool(entries, 'records.create');
      const rows = await prisma((p) =>
        p.agentRecord.findMany({ where: { guildId: GUILD_ID, collection: 'casino_balance' }, select: { id: true, createdAt: true, data: true } }),
      );
      const fresh = rows.filter((row) => row.createdAt > watermark && row.data.includes('"balance":100'));
      // Restaure : la ligne de test ne doit pas rester dans le casino du serveur.
      if (fresh.length > 0) {
        await prisma((p) => p.agentRecord.deleteMany({ where: { id: { in: fresh.map((row) => row.id) } } }));
      }
      return {
        pass: created && fresh.length > 0,
        note: `${created ? 'records.create réussi' : 'records.create sans succès'} · ${fresh.length} ligne(s) casino_balance créée(s) pendant le scénario, supprimée(s)`,
      };
    },
  );

  // ---- 13. Blackjack : ni sonde, ni fuite de balises internes, boutons câblés ----
  // Incident du 23/11 à 20:09 : le modèle testait surface.create avec des
  // surfaces « probe », puis, au plafond d'itérations, écrivait ses appels
  // d'outil en texte brut (`<｜DSML｜...>`) publié tel quel dans le salon. On
  // rejoue la même demande en live. Le clic sur un bouton exige une vraie
  // interaction Discord (non simulable en REST) : l'acquittement des clics
  // est couvert par surface.handlers.spec.ts, le clic réel reste à faire à la main.
  if (!only || only.includes('surface.blackjack')) {
    journal('scenario_start', { scenario: 'surface.blackjack' });
    // E2E_KEEP_SURFACES=1 : le panneau reste en place pour un clic à la main.
    // Son titre ne doit alors pas contenir « E2E » (le nettoyage global le supprimerait).
    const keep = process.env.E2E_KEEP_SURFACES === '1';
    const watermark = new Date(Date.now() - 2_000);
    await sleep(COOLDOWN_MS);
    await send(`Crée ici un jeu de blackjack jouable avec boutons contre la banque (cherche d\u0027abord la recette dans ta bibliothèque). Titre du panneau : « ${keep ? 'Blackjack, table de test clic' : 'E2E-suite blackjack'} ».`);
    const entries = await waitQuiescent(watermark, { maxMs: 240_000 });
    const surfaces = await prisma((p) =>
      p.interactiveSurface.findMany({ where: { guildId: GUILD_ID, createdAt: { gt: watermark } }, select: { id: true, definition: true, messageId: true, channelId: true } }),
    );
    const definitions = surfaces.map((surface) => ({ ...surface, definition: JSON.parse(surface.definition) }));
    const isProbe = (definition) =>
      /^(?:probe|test|ping|todo|placeholder)$/iu.test((definition.title ?? '').trim()) || /^(?:probe|test|ping)$/iu.test((definition.description ?? '').trim());
    const probes = definitions.filter((surface) => isProbe(surface.definition));
    const unwired = definitions.filter((surface) =>
      surface.definition.rows.some((row) => (row.kind === 'buttons' ? row.buttons : row.select.options).some((binding) => !Array.isArray(binding.pipeline) || binding.pipeline.length === 0)),
    );
    const messages = await rest(`/channels/${channelId}/messages?limit=50`).catch(() => []);
    const botMessages = messages.filter((message) => message.author?.id === me.id && Date.parse(message.timestamp) > watermark.getTime());
    const textOf = (message) => `${message.content ?? ''} ${JSON.stringify(message.components ?? '')}`;
    const leaks = botMessages.filter((message) => /<[｜|]|<\/?tool_call/iu.test(textOf(message)));
    const ceiling = botMessages.filter((message) => textOf(message).includes("Limite d'étapes atteinte"));
    const created = ranTool(entries, 'surface.create');
    const searches = entries.filter((entry) => entry.action === 'assistant.tool.search_tools').length;
    const opened = ranTool(entries, 'openSkill');
    // Restaure : triggers et solde de test ne restent pas dans le casino du serveur.
    const ids = surfaces.map((surface) => surface.id);
    if (!keep) {
      for (const surface of surfaces) {
        if (surface.messageId) await rest(`/channels/${surface.channelId}/messages/${surface.messageId}`, { method: 'DELETE' }).catch(() => {});
      }
      await prisma((p) => p.interactiveSurface.deleteMany({ where: { id: { in: ids } } }));
    }
    await prisma((p) => p.scheduledTrigger.updateMany({ where: { guildId: GUILD_ID, createdAt: { gt: watermark }, OR: [{ surfaceId: { in: ids } }, { cancelKey: { contains: 'blackjack' } }] }, data: { status: 'cancelled' } }));
    await prisma((p) => p.agentRecord.deleteMany({ where: { guildId: GUILD_ID, collection: 'casino_balance', createdAt: { gt: watermark } } }));
    verdict(
      'surface.blackjack',
      created && leaks.length === 0 && probes.length === 0 && unwired.length === 0 && ceiling.length === 0,
      `${created ? 'surface.create réussi' : 'surface.create sans succès'} · ${surfaces.length} surface(s), ${probes.length} sonde(s), ${unwired.length} bouton(s) non câblé(s) · ${leaks.length} fuite(s) de balises internes sur ${botMessages.length} message(s) du bot · ${opened ? 'recette ouverte' : 'recette non ouverte'} · ${searches} search_tools · ${ceiling.length > 0 ? 'plafond d\u0027étapes atteint' : 'plafond non atteint'} · clic réel non simulable`,
    );
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
    // Mémoire serveur qui cite une surface supprimée depuis : les runs
    // précédents effaçaient le panneau, pas l'entrée, et le modèle cherchait à
    // lire cette surface à chaque run (un tour perdu).
    const memories = await prisma((p) => p.guildMemory.findMany({ where: { guildId: GUILD_ID }, select: { id: true, content: true } }));
    let staleMemories = 0;
    for (const memory of memories) {
      const cited = [...String(memory.content ?? '').matchAll(/(?:surfaceId|surface) ([a-z0-9]{20,30})/giu)].map((m) => m[1]);
      if (cited.length === 0) continue;
      const alive = await prisma((p) => p.interactiveSurface.count({ where: { id: { in: cited } } }));
      if (alive > 0) continue;
      await prisma((p) => p.guildMemory.deleteMany({ where: { id: memory.id } }));
      staleMemories += 1;
    }
    journal('cleanup', { scope: 'memory_opt_out + test votes + surfaces de test + mémoire des surfaces disparues', surfaces: stale.length, staleMemories });
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
