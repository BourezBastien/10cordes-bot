/**
 * Rig GATE (Phase 1, refonte 22/11) : vérifie le comportement de la gate
 * refondue sur 6 scénarios, UNE exécution, E2E_ONLY filtrable :
 *  1. gate.intruder-webhook  : un webhook NON allowlisté ne déclenche RIEN
 *  2. gate.unaddressed       : message humain sans adresse hors salon dédié → silence
 *  3. gate.mention           : mention du bot → réponse (en reply au message)
 *  4. gate.reply-to-bot      : réponse à un message du bot → réponse
 *  5. gate.other-bot         : mention d'un autre bot sans nous → silence
 *  6. gate.silence           : rien dans le salon avant la réponse finale
 * Vérification : messages du bot après watermark + audit assistant.* depuis le watermark.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BOT_DIR = resolve(SCRIPT_DIR, '..');
const API = 'https://discord.com/api/v10';
const STAFF_HOOK_NAME = 'agent-e2e-guardian';
const INTRUDER_HOOK_NAME = 'e2e-gate-intruder';
const COOLDOWN_MS = 5_000;
const SILENCE_WAIT_MS = 35_000;
const REPLY_WAIT_MS = 90_000;

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
const snowflakeTs = (id) => Number(BigInt(id) >> 22n) + 1_420_070_400_000;

/** Dernier message du BOT dans un salon après un timestamp (poll). */
async function botMessageAfter(channelId, sinceMs, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(4_000);
    const messages = await rest(`/channels/${channelId}/messages?limit=20`).catch(() => []);
    const found = messages.find((m) => m.author.id === botId && snowflakeTs(m.id) >= sinceMs - 2_000);
    if (found) return found;
  }
  return null;
}

/** Le bot a-t-il traité quoi que ce soit (audit assistant.*) depuis un instant ?
 * assistant.intro exclu : réponse d'accroche aux « salut » nus du serveur,
 * pas une réaction au message test (bruit ambiant du serveur de dév). */
async function assistantActivitySince(since) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    return await prisma.auditLog.count({
      where: {
        createdAt: { gt: since },
        action: { startsWith: 'assistant.' },
        NOT: { action: 'assistant.intro' },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/** Une ligne d'audit d'une action depuis un instant (en base, metadata est du texte JSON). */
async function auditSince(since, action) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    return await prisma.auditLog.findFirst({ where: { createdAt: { gt: since }, action }, orderBy: { createdAt: 'desc' } });
  } finally {
    await prisma.$disconnect();
  }
}

/** Un tool a-t-il REUSSI depuis un instant ? (metadata.ok : le nom seul ne prouve rien) */
async function toolOkSince(since, tool) {
  const row = await auditSince(since, `assistant.tool.${tool}`);
  if (!row) return { ok: false, summary: 'tool non appelé' };
  try {
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    return { ok: metadata?.ok === true, summary: String(metadata?.summary ?? '').slice(0, 120) };
  } catch {
    return { ok: false, summary: 'audit illisible' };
  }
}

let botId;
const results = [];
const verdict = (name, pass, note = '') => {
  results.push({ name, pass });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${note ? ` : ${note}` : ''}`);
};

async function main() {
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',').map((s) => s.trim()) : null;
  console.log(`[E2E-gate] démarrage ${new Date().toISOString()} (E2E_ONLY=${process.env.E2E_ONLY ?? '-'})`);

  const me = await rest('/users/@me');
  botId = me.id;
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

  // Webhook STAFF : le guardian, que la gate reconnaît par son NOM quand
  // E2E_ENABLED=true (plus d'allowlist d'IDs). Intrus : un run interrompu
  // laisse le sien derrière lui, or Discord plafonne un salon à 15 webhooks
  // (23/11 : salon saturé, le rig ne pouvait plus créer le sien). On
  // réutilise le premier intrus trouvé et balaye les autres.
  const hooks = await rest(`/channels/${channelId}/webhooks`);
  let staffHook = hooks.find((h) => h.name === STAFF_HOOK_NAME && h.user?.id === botId);
  if (!staffHook) {
    staffHook = await rest(`/channels/${channelId}/webhooks`, { method: 'POST', body: JSON.stringify({ name: STAFF_HOOK_NAME }) });
  }
  const staleIntruders = hooks.filter((h) => h.name === INTRUDER_HOOK_NAME && h.user?.id === botId);
  for (const stale of staleIntruders.slice(1)) {
    await rest(`/webhooks/${stale.id}`, { method: 'DELETE' }).catch(() => {});
  }
  if (staleIntruders.length > 1) console.log(`[CLEANUP] ${staleIntruders.length - 1} webhook(s) intrus abandonné(s) supprimé(s).`);
  let intruderHook = staleIntruders[0];
  if (!intruderHook) {
    intruderHook = await rest(`/channels/${channelId}/webhooks`, {
      method: 'POST',
      body: JSON.stringify({ name: INTRUDER_HOOK_NAME }),
    });
  }
  const sendVia = (hook, content, extra = {}) =>
    rest(`/webhooks/${hook.id}/${hook.token}?wait=true`, {
      method: 'POST',
      body: JSON.stringify({ content, allowed_mentions: { parse: [] }, ...extra }),
    });

  // Salon NORMAL (hors dédié) pour le scénario non-adressé : premier salon texte visible.
  const channels = await rest(`/guilds/${guildId}/channels`);
  const normalChannel = channels.find((c) => c.type === 0 && c.id !== channelId);
  if (!normalChannel) throw new Error('aucun salon textuel hors salon dédié pour le scénario non-adressé');

  // Un autre bot du serveur pour le scénario 5 (si présent).
  let otherBotId = null;
  const members = await rest(`/guilds/${guildId}/members?limit=200`).catch(() => []);
  const otherBot = members.find((m) => m.user.bot && m.user.id !== botId);
  if (otherBot) otherBotId = otherBot.user.id;

  // ---- 1. Webhook NON allowlisté → silence total ----
  if (!only || only.includes('gate.intruder-webhook')) {
    await sleep(COOLDOWN_MS);
    const since = new Date();
    await sendVia(intruderHook, 'e2e-gate: message d\'un webhook non allowlisté, personne ne doit répondre ici.');
    const botMsg = await botMessageAfter(channelId, Date.now(), SILENCE_WAIT_MS);
    const auditCount = await assistantActivitySince(since);
    const quiet = !botMsg && auditCount === 0;
    verdict('gate.intruder-webhook', quiet, quiet ? 'ignoré (aucun message, aucun traitement)' : `réponse ou activité détectée (msg=${Boolean(botMsg)}, audit=${auditCount})`);
  }

  // ---- 2. Message humain NON adressé hors salon dédié → silence ----
  // Le message doit venir d'un webhook ALLOWLISTÉ (sinon le scénario 1
  // répondrait déjà) mais posté dans un salon NORMAL : on déplace
  // temporairement un webhook staff vers ce salon, puis on le remet.
  if (!only || only.includes('gate.unaddressed')) {
    await sleep(COOLDOWN_MS);
    const guildHooks = await rest(`/guilds/${guildId}/webhooks`);
    // Le seul webhook staff est le guardian lui-même (reconnu par son nom).
    const movable = guildHooks.find((h) => h.id === staffHook.id && h.user?.id === botId) ?? staffHook;
    if (!movable) {
      verdict('gate.unaddressed', false, 'aucun webhook staff déplaçable (ManageWebhooks ?)');
    } else {
      const moved = await rest(`/webhooks/${movable.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ channel_id: normalChannel.id }),
      }).catch(() => null);
      if (!moved) {
        verdict('gate.unaddressed', false, 'déplacement du webhook staff impossible');
      } else {
        const since = new Date();
        await rest(`/webhooks/${moved.id}/${moved.token}?wait=true`, {
          method: 'POST',
          body: JSON.stringify({ content: 'e2e-gate: conversation entre humains sans adresse au bot.', allowed_mentions: { parse: [] } }),
        });
        const botMsg = await botMessageAfter(normalChannel.id, Date.now(), SILENCE_WAIT_MS);
        const auditCount = await assistantActivitySince(since);
        const quiet = !botMsg && auditCount === 0;
        verdict('gate.unaddressed', quiet, quiet ? 'ignoré hors salon dédié (le triage passif est bien mort)' : `réponse détectée (msg=${Boolean(botMsg)}, audit=${auditCount})`);
        await rest(`/webhooks/${moved.id}`, { method: 'PATCH', body: JSON.stringify({ channel_id: channelId }) }).catch(() => {});
      }
    }
  }

  // ---- 3. Mention du bot → réponse ----
  if (!only || only.includes('gate.mention')) {
    await sleep(COOLDOWN_MS);
    const sent = await sendVia(staffHook, `<@${botId}> e2e-gate: réponds simplement « gate-mention-ok » et rien d'autre.`);
    const reply = await botMessageAfter(channelId, snowflakeTs(sent.id), REPLY_WAIT_MS);
    const isReply = reply?.message_reference?.message_id === sent.id;
    verdict('gate.mention', Boolean(reply), reply ? (isReply ? 'réponse en reply au message' : 'réponse reçue (sans reply)') : 'aucune réponse');
  }

  // ---- 4. Réponse à un message du bot → réponse ----
  if (!only || only.includes('gate.reply-to-bot')) {
    await sleep(COOLDOWN_MS);
    const botMessages = await rest(`/channels/${channelId}/messages?limit=30`);
    const lastBotMsg = botMessages.find((m) => m.author.id === botId && !m.webhook_id);
    if (!lastBotMsg) {
      verdict('gate.reply-to-bot', false, 'aucun message du bot à répondre');
    } else {
      const sent = await sendVia(staffHook, 'e2e-gate: suite de notre conversation, réponds « gate-reply-ok ».', {
        message_reference: { message_id: lastBotMsg.id },
      });
      const reply = await botMessageAfter(channelId, snowflakeTs(sent.id), REPLY_WAIT_MS);
      verdict('gate.reply-to-bot', Boolean(reply), reply ? 'réponse déclenchée par messageReference' : 'aucune réponse au reply');
    }
  }

  // ---- 5. Mention d'un AUTRE bot sans nous → silence ----
  if (!only || only.includes('gate.other-bot')) {
    if (!otherBotId) {
      console.log('[SKIP] gate.other-bot : aucun autre bot sur le serveur de test.');
      results.push({ name: 'gate.other-bot', pass: true });
    } else {
      await sleep(COOLDOWN_MS);
      const since = new Date();
      await sendVia(staffHook, `<@${otherBotId}> e2e-gate: hey l'autre bot, fais ça pour moi stp.`);
      const botMsg = await botMessageAfter(channelId, Date.now(), SILENCE_WAIT_MS);
      const auditCount = await assistantActivitySince(since);
      const quiet = !botMsg && auditCount === 0;
      verdict('gate.other-bot', quiet, quiet ? 'redirigé vers l\'autre bot, silence' : `le bot a répondu (msg=${Boolean(botMsg)}, audit=${auditCount})`);
    }
  }

  // ---- 6. Silence en coulisse : RIEN dans le salon avant la réponse finale ----
  // Une demande qui passe par un tool (plusieurs tours). Pendant tout le
  // traitement, le salon est échantillonné toutes les 2 s : une ligne de
  // statut s'affiche puis s'efface, un relevé fait après coup ne la verrait
  // pas. Le bot ne doit y écrire que la réponse finale. L'indicateur
  // « écrit… » n'est pas un message : il est couvert par les tests unitaires.
  if (!only || only.includes('gate.silence')) {
    await sleep(COOLDOWN_MS);
    const sent = await sendVia(staffHook, `<@${botId}> e2e-gate: avec search_skills, cherche la recette des salons vocaux temporaires, puis réponds exactement « gate-silence-ok » et rien d'autre.`);
    const sinceTs = snowflakeTs(sent.id);
    const since = new Date(Date.now() - 1_000);
    const seen = new Map();
    let samples = 0;
    const sample = async () => {
      samples += 1;
      const messages = await rest(`/channels/${channelId}/messages?limit=30`).catch(() => []);
      for (const m of messages) {
        if (m.author.id === botId && snowflakeTs(m.id) >= sinceTs - 2_000 && !seen.has(m.id)) seen.set(m.id, m);
      }
    };
    let settled = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < REPLY_WAIT_MS) {
      await sleep(2_000);
      await sample();
      settled = (await auditSince(since, 'assistant.reply')) ?? (await auditSince(since, 'assistant.error'));
      if (settled) break;
    }
    // La réponse peut arriver juste après son audit : un dernier échantillon.
    await sleep(2_000);
    await sample();

    const tool = await toolOkSince(since, 'search_skills');
    const reply = [...seen.values()].find((m) => String(m.content ?? '').includes('gate-silence-ok'));
    const others = [...seen.values()].filter((m) => m !== reply);
    // Un tool doit avoir tourné : sans lui, la demande n'a pas eu de phase de travail, le scénario ne prouve rien.
    const pass = Boolean(settled?.action === 'assistant.reply' && reply && tool.ok && others.length === 0);
    verdict(
      'gate.silence',
      pass,
      pass
        ? `aucun message avant la réponse finale (${samples} échantillons sur ${Math.round((Date.now() - startedAt) / 1000)} s, search_skills ok)`
        : `soldé=${settled?.action ?? 'non'} · réponse=${Boolean(reply)} · search_skills ${tool.ok ? 'ok' : `non réussi (${tool.summary})`} · messages du bot : ${seen.size}, hors réponse : ${others.map((m) => String(m.content ?? '').slice(0, 60)).join(' | ') || 'aucun'}`,
    );
  }

  // ---- CLEANUP ----
  await rest(`/channels/${channelId}/webhooks/${intruderHook.id}`, { method: 'DELETE' }).catch(() => {});

  const passCount = results.filter((r) => r.pass).length;
  console.log(`[SUMMARY] ${passCount}/${results.length} PASS`);
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((error) => {
  console.error('[FAIL]', error.message);
  process.exit(1);
});
