/**
 * Batterie E2E des tools d'écriture — chaîne complète via l'agent.
 *
 * Principe : chaque scénario envoie un message webhook dans le salon dédié IA.
 * Le rig fonctionne parce que les webhooks listés dans E2E_STAFF_WEBHOOK_IDS
 * (voir app.env.ts) parlent avec les permissions staff : la seule clé d'entrée
 * est le token du webhook, que seul ce script (et guardian.mjs) possède.
 *
 * Pour chaque scénario : watermark d'audit → message webhook → attente de
 * quiescence (plus de nouvelle entrée audit pendant 6s, max 100s) →
 * vérifications REST + tools attendus dans l'audit.
 *
 * La phase CLEANUP remet la guild au propre (salons/rôles de test supprimés,
 * ban retiré, nick du bot réinitialisé).
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BOT_DIR = resolve(SCRIPT_DIR, '..');
const ENV_FILE = resolve(BOT_DIR, '.env');
const LOCK_FILE = resolve(BOT_DIR, 'e2e.lock');
const API = 'https://discord.com/api/v10';
const WEBHOOK_NAME = 'agent-e2e-guardian';
const COOLDOWN_MS = 5_000;
const DUMMY_USER_ID = '123456789012345678';

/** Verrou anti-collision : deux batteries ne doivent jamais tourner en parallèle
 * (deux passages d'automatisation dans la même fenêtre 3 h). Verrou périmé > 30
 * min = ignoré (crash précédent sans cleanup). */
function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    const age = Date.now() - statSync(LOCK_FILE).mtimeMs;
    if (age < 30 * 60 * 1000) {
      console.error('[FAIL] une batterie est déjà en cours (e2e.lock récent).');
      process.exit(1);
    }
  }
  writeFileSync(LOCK_FILE, String(Date.now()));
}

function releaseLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    /* rien à nettoyer */
  }
}

function loadEnv() {
  const env = {};
  for (const raw of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const token = env.DISCORD_TOKEN;
if (!token) {
  console.error('[FAIL] DISCORD_TOKEN absent de .env');
  process.exit(1);
}
// Prisma (audit) lit process.env : depuis le .env ou la valeur par défaut du framework.
process.env.DATABASE_URL ??= env.DATABASE_URL ?? 'file:../data/bot.db';

async function rest(path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
  });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
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
      select: { action: true, createdAt: true, metadata: true, actorId: true },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function waitQuiescent(watermark, { requireTool = true, maxMs = 100000, quietMs = 6000 } = {}) {
  const start = Date.now();
  let entries = [];
  let lastChange = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(3000);
    entries = await newAuditSince(watermark);
    if (entries.length > 0) lastChange = Date.now();
    const hasTool = entries.some((e) => e.action.startsWith('assistant.tool.'));
    if (Date.now() - lastChange >= quietMs && (hasTool || !requireTool)) break;
  }
  const hasReply = entries.some((e) => {
    if (e.action !== 'assistant.reply') return false;
    try {
      return JSON.parse(e.metadata ?? '{}').silent !== true;
    } catch {
      return true;
    }
  });
  return { entries, hasReply };
}

/** Garantit que l'id du webhook est dans E2E_STAFF_WEBHOOK_IDS de .env. */
function ensureWhitelist(id) {
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  const line = text.split(/\r?\n/).find((l) => l.startsWith('E2E_STAFF_WEBHOOK_IDS='));
  const ids = line
    ? line.slice('E2E_STAFF_WEBHOOK_IDS='.length).split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  if (ids.includes(id)) return false;
  const merged = [...new Set([...ids, id])].join(',');
  if (line) {
    text = text.replace(line, `E2E_STAFF_WEBHOOK_IDS=${merged}`);
  } else {
    text = `${text}${text.endsWith('\n') || text.length === 0 ? '' : '\n'}E2E_STAFF_WEBHOOK_IDS=${merged}\n`;
  }
  writeFileSync(ENV_FILE, text);
  return true;
}

async function main() {
  acquireLock();
  const startedAt = new Date();
  console.log(`[E2E] démarrage ${startedAt.toISOString()}`);

  const me = await rest('/users/@me');
  const guilds = await rest('/users/@me/guilds');
  const guildId = guilds[0].id;

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  let channelId;
  try {
    const g = await prisma.guild.findUnique({ where: { id: guildId }, select: { settings: true } });
    channelId = g?.settings ? JSON.parse(g.settings)?.assistant?.channelId ?? null : null;
  } finally {
    await prisma.$disconnect();
  }
  if (!channelId) {
    const channels = await rest(`/guilds/${guildId}/channels`);
    channelId = channels.find((c) => c.type === 0)?.id ?? null;
  }
  if (!channelId) throw new Error('aucun salon texte trouvé');

  const hooks = await rest(`/channels/${channelId}/webhooks`);
  let hook = hooks.find((h) => h.name === WEBHOOK_NAME && h.user?.id === me.id);
  if (!hook) {
    hook = await rest(`/channels/${channelId}/webhooks`, {
      method: 'POST',
      body: JSON.stringify({ name: WEBHOOK_NAME }),
    });
  }

  if (ensureWhitelist(hook.id)) {
    releaseLock();
    console.log(`[SETUP] E2E_STAFF_WEBHOOK_IDS=${hook.id} ajouté à .env`);
    console.log('[SETUP] redémarre le bot puis relance ce script.');
    process.exit(2);
  }

  const send = (content) =>
    rest(`/webhooks/${hook.id}/${hook.token}?wait=true`, {
      method: 'POST',
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });

  const api = {
    channels: () => rest(`/guilds/${guildId}/channels`),
    roles: () => rest(`/guilds/${guildId}/roles`),
    member: (id) => rest(`/guilds/${guildId}/members/${id}`).catch(() => null),
    members: () => rest(`/guilds/${guildId}/members?limit=200`),
    bans: () => rest(`/guilds/${guildId}/bans`),
    messages: (chId) => rest(`/channels/${chId}/messages?limit=10`),
    channelDelete: (id) => rest(`/channels/${id}`, { method: 'DELETE' }),
    memberPatch: (id, body) => rest(`/guilds/${guildId}/members/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    selfNick: (nick) => rest(`/guilds/${guildId}/members/@me`, { method: 'PATCH', body: JSON.stringify({ nick }) }),
    roleDelete: (id) => rest(`/guilds/${guildId}/roles/${id}`, { method: 'DELETE' }),
    unban: (id) => rest(`/guilds/${guildId}/bans/${id}`, { method: 'DELETE' }).catch(() => null),
  };

  const guildInfo = await rest(`/guilds/${guildId}`);
  const ownerId = guildInfo.owner_id;
  const members = await api.members();
  const human = members.find((m) => !m.user.bot && m.user.id !== ownerId);
  console.log(`[E2E] cible timeout : ${human ? `humain ${human.user.username}` : 'owner (refus propre attendu)'}`);

  const results = [];
  const verdict = (name, pass, note = '') => {
    results.push({ name, pass, note });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${note ? ` — ${note}` : ''}`);
  };

  const runScenario = async (name, prompt, expectTools, check) => {
    // E2E_ONLY="scenario1,scenario2" pour ne rejouer qu'une partie.
    const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',').map((s) => s.trim()) : null;
    if (only && !only.includes(name)) return;
    const watermark = new Date(Date.now() - 2000);
    await sleep(COOLDOWN_MS);
    await send(prompt);
    const { entries, hasReply } = await waitQuiescent(watermark);
    const toolActions = entries.filter((e) => e.action.startsWith('assistant.tool.'));
    const missingTools = expectTools.filter((t) => !toolActions.some((e) => e.action === `assistant.tool.${t}`));
    let checkNote = '';
    let checkPass = true;
    try {
      const out = await check({ entries, hasReply });
      checkPass = out.pass;
      checkNote = out.note ?? '';
    } catch (error) {
      checkPass = false;
      checkNote = `check error: ${error.message}`;
    }
    const pass = missingTools.length === 0 && checkPass;
    verdict(name, pass, `${missingTools.length > 0 ? `tools manquants: ${missingTools.join(', ')} ; ` : ''}${checkNote}`);
  };

  const findChannel = async (name) => (await api.channels()).find((c) => c.name === name) ?? null;
  const findRole = async (name) => (await api.roles()).find((r) => r.name === name) ?? null;

  // ---- Scénarios ----

  await runScenario(
    'createCategory',
    'Crée une catégorie nommée e2e-guardian-cat.',
    ['createCategory'],
    async () => {
      const cat = await findChannel('e2e-guardian-cat');
      return { pass: cat !== null && cat.type === 4, note: cat ? `id ${cat.id}` : 'catégorie absente' };
    },
  );

  await runScenario(
    'createChannel',
    'Crée un salon texte e2e-guardian dans la catégorie e2e-guardian-cat.',
    ['createChannel'],
    async () => {
      const [cat, ch] = await Promise.all([findChannel('e2e-guardian-cat'), findChannel('e2e-guardian')]);
      const ok = ch !== null && ch.type === 0 && cat !== null && ch.parent_id === cat.id;
      return { pass: ok, note: ch ? (ok ? 'dans la catégorie' : 'hors catégorie') : 'salon absent' };
    },
  );

  // Autosuffisance en mode E2E_ONLY : le salon de base est créé via REST
  // quand les scénarios de création n'ont pas tourné.
  {
    const ch = await findChannel('e2e-guardian');
    if (!ch) {
      await rest(`/guilds/${guildId}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name: 'e2e-guardian', type: 0 }),
      }).catch(() => {});
    }
  }

  await runScenario(
    'setChannelTopic',
    'Mets comme sujet du salon e2e-guardian : Salon de test E2E.',
    ['setChannelTopic'],
    async () => {
      const ch = await findChannel('e2e-guardian');
      const topic = (ch?.topic ?? '').trim();
      const ok = topic === 'Salon de test E2E' || topic === 'Salon de test E2E.';
      return { pass: ok, note: `topic="${topic}"` };
    },
  );

  await runScenario(
    'renameChannel',
    'Renomme le salon e2e-guardian en e2e-guardian-2.',
    ['renameChannel'],
    async () => {
      const ch = await findChannel('e2e-guardian-2');
      return { pass: ch !== null, note: ch ? 'renommé' : 'salon e2e-guardian-2 absent' };
    },
  );

  await runScenario(
    'setChannelSlowmode',
    'Active un slowmode de 5 secondes dans e2e-guardian-2.',
    ['setChannelSlowmode'],
    async () => {
      const ch = await findChannel('e2e-guardian-2');
      return { pass: ch?.rate_limit_per_user === 5, note: `slowmode=${ch?.rate_limit_per_user ?? '?'}` };
    },
  );

  // Restreindre l'accès d'un salon à un rôle : overwrite @everyone deny
  // ViewChannel + overwrite rôle allow ViewChannel. Autosuffisant en ONLY.
  {
    const ch = await findChannel('e2e-guardian-2');
    if (!ch) {
      await rest(`/guilds/${guildId}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name: 'e2e-guardian-2', type: 0 }),
      }).catch(() => {});
    }
  }
  const restrictRole = (await api.roles()).find((r) => r.name !== '@everyone' && !r.managed);
  await runScenario(
    'setChannelOverwrite',
    `Restreins le salon e2e-guardian-2 au rôle ${restrictRole ? `${restrictRole.name} (id ${restrictRole.id})` : 'du staff'} : refuse ViewChannel à @everyone puis autorise-le à ce rôle.`,
    ['setChannelOverwrite'],
    async () => {
      const ch = await findChannel('e2e-guardian-2');
      if (!ch) return { pass: false, note: 'salon absent' };
      const overwrites = await rest(`/channels/${ch.id}`).then((c) => c.permission_overwrites ?? []);
      const viewBit = 1024; // ViewChannel = 1 << 10
      const everyoneDenied = overwrites.some(
        (o) => o.id === guildId && (BigInt(o.deny) & BigInt(viewBit)) !== 0n,
      );
      const roleAllowed = restrictRole
        ? overwrites.some((o) => o.id === restrictRole.id && (BigInt(o.allow) & BigInt(viewBit)) !== 0n)
        : false;
      return {
        pass: everyoneDenied && roleAllowed,
        note: `@everyone deny ViewChannel=${everyoneDenied} ; rôle allow ViewChannel=${roleAllowed}`,
      };
    },
  );

  await runScenario(
    'moveChannel',
    'Déplace le salon e2e-guardian-2 à la racine du serveur (plus de catégorie parente).',
    ['moveChannel'],
    async () => {
      const ch = await findChannel('e2e-guardian-2');
      return { pass: ch !== null && ch.parent_id === null, note: `parent=${ch?.parent_id ?? 'aucun'}` };
    },
  );

  let sentMessageId = null;
  await runScenario(
    'sendMessage',
    'Envoie « Sonde e2e guardian » dans le salon e2e-guardian-2.',
    ['sendMessage'],
    async () => {
      const ch = await findChannel('e2e-guardian-2');
      if (!ch) return { pass: false, note: 'salon absent' };
      const msgs = await api.messages(ch.id);
      const probe = msgs.find((m) => m.content.includes('Sonde e2e guardian'));
      sentMessageId = probe ? probe.id : null;
      return { pass: probe !== undefined, note: probe ? `message ${probe.id}` : 'message absent' };
    },
  );

  // Suppression ciblée : deleteMessage est l'outil attendu, une purge limitée
  // à ce seul message est un équivalent accepté (variance de choix du modèle).
  // Autosuffisant : en mode E2E_ONLY les scénarios de création n'ont pas tourné,
  // donc salon + message de référence sont créés ici via REST si absents.
  {
    const ch = await findChannel('e2e-guardian-2');
    if (!ch) {
      await rest(`/guilds/${guildId}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name: 'e2e-guardian-2', type: 0 }),
      }).catch(() => {});
    }
    const fresh = await findChannel('e2e-guardian-2');
    if (fresh) {
      const msgs = await api.messages(fresh.id);
      if (!msgs.some((m) => m.content.includes('Sonde e2e guardian'))) {
        await rest(`/channels/${fresh.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ content: 'Sonde e2e guardian' }),
        }).catch(() => {});
      }
      const updated = await api.messages(fresh.id);
      sentMessageId = updated.find((m) => m.content.includes('Sonde e2e guardian'))?.id ?? null;
    }
  }
  await runScenario(
    'deleteMessage',
    'Supprime le dernier message du salon e2e-guardian-2.',
    [],
    async ({ entries }) => {
      const targeted = entries.some((e) => e.action === 'assistant.tool.deleteMessage');
      const purged = entries.some((e) => {
        if (e.action !== 'assistant.tool.purgeMessages') return false;
        try {
          return /1 message/.test(JSON.parse(e.metadata).summary ?? '');
        } catch {
          return false;
        }
      });
      const ch = await findChannel('e2e-guardian-2');
      if (!ch) return { pass: false, note: 'salon absent' };
      const msgs = await api.messages(ch.id);
      const gone = sentMessageId !== null && !msgs.some((m) => m.id === sentMessageId);
      const via = targeted ? 'deleteMessage' : purged ? 'purgeMessages (1 message)' : 'aucun tool de suppression';
      return { pass: gone && (targeted || purged), note: `via ${via} ; vérifié absent` };
    },
  );

  await runScenario(
    'createRole',
    'Crée un rôle e2e-guardian-role couleur #e67e22.',
    ['createRole'],
    async () => {
      const role = await findRole('e2e-guardian-role');
      return { pass: role !== null, note: role ? `id ${role.id}` : 'rôle absent' };
    },
  );

  await runScenario(
    'renameRole',
    'Renomme le rôle e2e-guardian-role en e2e-guardian-role-2.',
    ['renameRole'],
    async () => {
      const role = await findRole('e2e-guardian-role-2');
      return { pass: role !== null, note: role ? 'renommé' : 'e2e-guardian-role-2 absent' };
    },
  );

  await runScenario(
    'setRoleColor',
    'Passe le rôle e2e-guardian-role-2 en bleu (#3498db).',
    ['setRoleColor'],
    async () => {
      const role = await findRole('e2e-guardian-role-2');
      return { pass: role !== null && role.color === 0x3498db, note: `color=${role ? role.color : '?'}` };
    },
  );

  await runScenario(
    'addRoleToMember + removeRoleFromMember',
    `Attribue le rôle e2e-guardian-role-2 au bot (id ${me.id}), puis retire-le-lui immédiatement.`,
    ['addRoleToMember', 'removeRoleFromMember'],
    async () => {
      const roleId = (await findRole('e2e-guardian-role-2'))?.id ?? '';
      const botMember = await api.member(me.id);
      const stillHas = botMember !== null && Array.isArray(botMember.roles) && botMember.roles.includes(roleId);
      return { pass: !stillHas, note: 'rôle posé puis retiré au bot' };
    },
  );

  await runScenario(
    'muteMember (refus hiérarchie)',
    `Consulte le membre ${ownerId} avec getMemberInfo puis exclus-le temporairement 1 minute s'il est excluable (c'est l'owner du serveur).`,
    [],
    async ({ entries, hasReply }) => {
      const call = entries.find((e) => e.action === 'assistant.tool.muteMember');
      if (call) {
        let ok = '?';
        try {
          ok = JSON.parse(call.metadata).ok;
        } catch {
          ok = '?';
        }
        return { pass: true, note: `tool exécuté, ok=${ok} (refus Discord/hiérarchie attendu sur l'owner)` };
      }
      const verified = entries.some((e) => e.action === 'assistant.tool.getMemberInfo');
      return {
        pass: verified && hasReply,
        note: verified ? 'membre consulté puis refus expliqué : correct' : 'ni tool ni réponse',
      };
    },
  );

  // Le ban est destructive : il doit finir en PLAN (proposePlan ou banMember),
  // jamais appliqué directement. Le panneau avec boutons est posté par le tool.
  await runScenario(
    'banMember (plan confirmatoire)',
    `Bannis l'utilisateur ${DUMMY_USER_ID} pour raison « test e2e ».`,
    [],
    async ({ entries }) => {
      const planned = entries.find(
        (e) => e.action === 'assistant.tool.banMember' || e.action === 'assistant.tool.proposePlan',
      );
      let ok = '?';
      if (planned) {
        try {
          ok = JSON.parse(planned.metadata).ok;
        } catch {}
      }
      const bans = await api.bans();
      const applied = bans.some((b) => b.user.id === DUMMY_USER_ID);
      return {
        pass: planned !== undefined && ok === true && !applied,
        note: `via ${planned ? planned.action.replace('assistant.tool.', '') : 'aucun tool'} ok=${ok} ; ${applied ? 'BAN APPLIQUÉ (inattendu !)' : 'aucun ban appliqué avant confirmation'}`,
      };
    },
  );

  // Suppression groupée : UN plan multi-ops plutôt que N plans séparés.
  for (const name of ['e2e-guardian', 'e2e-guardian-2']) {
    const ch = await findChannel(name);
    if (!ch) {
      await rest(`/guilds/${guildId}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name, type: 0 }),
      }).catch(() => {});
    }
  }
  await runScenario(
    'proposePlan (suppression groupée)',
    'Supprime les salons e2e-guardian et e2e-guardian-2 en un seul plan groupé.',
    ['proposePlan'],
    async ({ entries }) => {
      const call = entries.find((e) => e.action === 'assistant.tool.proposePlan');
      let ok = '?';
      let summary = '';
      if (call) {
        try {
          const meta = JSON.parse(call.metadata);
          ok = meta.ok;
          summary = meta.summary ?? '';
        } catch {}
      }
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      let opsCount = -1;
      try {
        const plan = await prisma.agentPlan.findFirst({ orderBy: { createdAt: 'desc' }, select: { ops: true } });
        opsCount = plan ? (JSON.parse(plan.ops) ?? []).length : -1;
      } finally {
        await prisma.$disconnect();
      }
      return {
        pass: call !== undefined && ok === true && opsCount >= 2,
        note: `ok=${ok} ; ${opsCount} op(s) dans le dernier plan ; ${summary.includes('Panneau') ? 'panneau posté' : summary.slice(0, 80)}`,
      };
    },
  );

  // Un ban réel exige une vraie cible (Discord refuse « Unknown User » sur un
  // ID sans compte) : on vérifie le comportement (consulter l'état via
  // getBans puis répondre), pas l'effet. Le test complet unban s'inclut dans
  // les tests utilisateur avec un vrai membre banni.
  await runScenario(
    'unbanMember (état cohérent)',
    `Consulte la liste des bans avec getBans puis débannis l'utilisateur ${DUMMY_USER_ID} s'il y figure.`,
    [],
    async ({ entries, hasReply }) => {
      const verified = entries.some(
        (e) => e.action === 'assistant.tool.unbanMember' || e.action === 'assistant.tool.getBans',
      );
      return { pass: verified && hasReply, note: verified ? 'état vérifié puis réponse cohérente' : 'aucune vérification' };
    },
  );

  // État propre : le nick d'un run précédent pourrait persister (le cleanup
  // passe par /members/@me, seul endpoint fiable pour son propre nick).
  await api.selfNick(null).catch(() => {});
  await runScenario(
    'setNickname',
    'Renomme le bot (10cordes) en 10cordes-E2E sur ce serveur.',
    ['setNickname'],
    async () => {
      const botMember = await api.member(me.id);
      return { pass: botMember !== null && botMember.nick === '10cordes-E2E', note: `nick="${botMember?.nick ?? ''}"` };
    },
  );

  await runScenario(
    'skipReply (silence demandé)',
    'Crée un salon e2e-silent-check sans me répondre.',
    ['createChannel'],
    async ({ hasReply }) => {
      const ch = await findChannel('e2e-silent-check');
      const ok = ch !== null && !hasReply;
      return {
        pass: ok,
        note: ch ? (hasReply ? 'salon créé MAIS une réponse a été envoyée' : 'salon créé, aucun message envoyé') : 'salon absent',
      };
    },
  );

  // ---- CLEANUP ----
  console.log('[CLEANUP] remise au propre...');
  const cleanupNote = [];
  for (const name of ['e2e-silent-check', 'e2e-guardian-2', 'e2e-guardian', 'e2e-guardian-cat']) {
    const ch = await findChannel(name);
    if (ch) {
      try {
        await api.channelDelete(ch.id);
        cleanupNote.push(`${name}: supprimé`);
      } catch (e) {
        cleanupNote.push(`${name}: ${e.message.slice(0, 60)}`);
      }
    }
  }
  const role = await findRole('e2e-guardian-role-2');
  if (role) {
    try {
      await api.roleDelete(role.id);
      cleanupNote.push('rôle: supprimé');
    } catch (e) {
      cleanupNote.push(`rôle: ${e.message.slice(0, 60)}`);
    }
  }
  await api.unban(DUMMY_USER_ID);
  await api.selfNick(null).catch((e) => cleanupNote.push(`nick: ${e.message.slice(0, 60)}`));
  console.log(`[CLEANUP] ${cleanupNote.join(' ; ') || 'rien à nettoyer'}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`[SUMMARY] ${results.length - failed.length}/${results.length} scénarios PASS`);
  if (failed.length > 0) {
    console.log(`[SUMMARY] échecs: ${failed.map((f) => f.name).join(', ')}`);
    releaseLock();
    process.exitCode = 1;
    return;
  }
  releaseLock();
}

main().catch((error) => {
  releaseLock();
  console.error(`[FAIL] e2e crash: ${error?.stack ?? error}`);
  process.exit(1);
});
