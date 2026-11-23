/**
 * RIG PIVOT (Phase 2.4) — le cas démonstrateur du moteur générique :
 * 1. surface.create par prompt : panel avec bouton « Relancer » ROUGE DISABLED
 * 2. trigger.schedule par prompt : once dans ~45s, condition state.claimedBy == null,
 *    step updateComponent → bouton VERT ACTIVÉ
 * 3. REDÉMARRAGE DU BOT PENDANT LE TIMER (kill + guardian)
 * 4. Au reboot : le trigger est RATTRAPÉ, le message est édité, le bouton
 *    passe au customId actif surface:act (cliquable)
 * UNE exécution, E2E_ONLY filtrable, tout nettoyé.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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
if (!token) process.exit(1);
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

async function prisma(fn) {
  const { PrismaClient } = await import('@prisma/client');
  const p = new PrismaClient();
  try {
    return await fn(p);
  } finally {
    await p.$disconnect();
  }
}

/** Attend qu'un tool précis ait tourné (audit) et retourne sa summary. */
async function awaitTool(action, since, { maxMs = 120_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(4_000);
    const rows = await prisma((p) =>
      p.auditLog.findMany({
        where: { createdAt: { gt: since }, action: `assistant.tool.${action}` },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { metadata: true },
      }),
    );
    if (rows.length > 0) return String(rows[0].metadata ?? '');
    // Attente aussi la fin de traitement (réponse postée) avant timeout.
  }
  return null;
}

const APIKEY = env.HTTP_API_KEY ?? '';
async function waitHealthz(maxMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const code = await fetch('http://127.0.0.1:3000/healthz', { headers: APIKEY ? { 'X-Api-Key': APIKEY } : {} })
      .then((r) => r.status)
      .catch(() => 0);
    if (code === 200) return true;
    await sleep(5_000);
  }
  return false;
}

async function main() {
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',').map((s) => s.trim()) : null;
  console.log(`[e2e-surface] démarrage ${new Date().toISOString()}`);

  const guilds = await rest('/users/@me/guilds');
  const guildId = guilds.find((g) => g.id === env.E2E_GUILD_ID)?.id;
  if (!guildId) throw new Error('E2E_GUILD_ID introuvable');

  const channelId = await prisma((p) =>
    p.guild.findUnique({ where: { id: guildId }, select: { settings: true } }).then((g) => (g ? JSON.parse(g.settings)?.assistant?.channelId ?? null : null)),
  );
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
  const verdict = (name, pass, note = '') => {
    results.push({ name, pass });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${note ? ` — ${note}` : ''}`);
  };

  if (!only || only.includes('pivot.create')) {
    await sleep(COOLDOWN_MS);
    const since = new Date(Date.now() - 2_000);
    await send(
      'Crée une surface avec surface.create dans ce salon (kind "e2e-pivot"), avec EXACTEMENT cette définition JSON (réponds juste fait) :\n' +
        '{"title":"E2E Surface Pivot","description":"Bouton relancer : rouge desactive, passe vert au timer","rows":[{"kind":"buttons","buttons":[{"key":"relancer","label":"Relancer","style":"danger","disabled":true,"pipeline":[{"type":"setState","path":"clicked","mode":"increment"}]}]}],"initialState":{"claimedBy":null}}',
    );
    const summary = await awaitTool('surface.create', since);
    const surfaceId = summary?.match(/surfaceId ([a-z0-9]+)/iu)?.[1] ?? null;
    const row = surfaceId ? await prisma((p) => p.interactiveSurface.findUnique({ where: { id: surfaceId } })) : null;
    const message = row?.messageId
      ? await rest(`/channels/${channelId}/messages/${row.messageId}`).catch(() => null)
      : null;
    // Bouton initial DISABLED : rendu statique surface:off (non cliquable).
    const startsDisabled = message ? JSON.stringify(message.components).includes('surface:off') : false;
    verdict('pivot.create', Boolean(row && startsDisabled), row ? `surface ${surfaceId.slice(-6)} postée, bouton désactivé (surface:off)` : 'surface.create non exécuté');
    if (!row) process.exit(1);
    globalThis.__surfaceId = row.id;
  }

  const surfaceId = globalThis.__surfaceId ?? (await prisma((p) => p.interactiveSurface.findFirst({ where: { guildId, kind: 'e2e-pivot' }, orderBy: { createdAt: 'desc' } })))?.id;
  if (!surfaceId) {
    console.error('[FAIL] surface pivot introuvable');
    process.exit(1);
  }

  if (!only || only.includes('pivot.trigger-green')) {
    await sleep(COOLDOWN_MS);
    const since = new Date(Date.now() - 2_000);
    await send(
      `Planifie avec trigger.schedule sur la surface ${surfaceId} : cancelKey "pivot-green-${surfaceId.slice(-6)}", once dans 45 secondes, condition JSON {"kind":"state","path":"claimedBy","op":"eq","value":null}, steps JSON [{"type":"updateComponent","binding":"relancer","patch":{"style":"success","disabled":false}}] (réponds juste fait).`,
    );
    const scheduled = await awaitTool('trigger.schedule', since);
    const armed = await prisma((p) => p.scheduledTrigger.findFirst({ where: { surfaceId, status: 'armed' }, orderBy: { createdAt: 'desc' } }));
    verdict('pivot.trigger-green', Boolean(scheduled && armed), armed ? `trigger armé (runAt ${armed.runAt?.toISOString()})` : 'trigger.schedule non exécuté');

    // REDÉMARRAGE DU BOT PENDANT LE TIMER (le point critique du rattrapage).
    console.log('[REBOOT] kill du bot PENDANT LE TIMER...');
    try {
      const pid = execFileSync('powershell', ['-Command', "(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).OwningProcess"], { encoding: 'utf8' }).trim();
      if (pid) execFileSync('powershell', ['-Command', `Stop-Process -Id ${pid} -Force`]);
    } catch {
      /* le bot était peut-être déjà arrêté */
    }
    await sleep(3_000);
    // Le guardian relance le bot mais peut sortir non-zéro si son propre
    // healthz dépasse son délai interne (boot ~20-30 s) : son exit code n'est
    // PAS le verdict — le vrai critère reste waitHealthz ci-dessous.
    try {
      const guardian = execFileSync('node', ['scripts/guardian.mjs'], { cwd: BOT_DIR, detached: true, stdio: 'ignore' });
      void guardian;
    } catch {
      console.log('[REBOOT] guardian sorti non-zéro, le bot a pu être relancé quand même — on attend healthz...');
    }
    const up = await waitHealthz();
    verdict('pivot.reboot', up, up ? 'bot de retour (healthz 200)' : 'healthz KO après reboot');
    if (!up) process.exit(1);

    // Attente du RATTRAPAGE : le message doit être édité avec le customId
    // ACTIF surface:act~b=relancer (bouton vert cliquable).
    const deadline = Date.now() + 150_000;
    let greened = false;
    let triggerDone = false;
    while (Date.now() < deadline && !(greened && triggerDone)) {
      await sleep(8_000);
      const row = await prisma((p) => p.interactiveSurface.findUnique({ where: { id: surfaceId } }));
      if (row?.messageId) {
        const message = await rest(`/channels/${channelId}/messages/${row.messageId}`).catch(() => null);
        if (message && JSON.stringify(message.components).includes('surface:act')) greened = true;
      }
      triggerDone = await prisma((p) => p.scheduledTrigger.count({ where: { surfaceId, cancelKey: { startsWith: 'pivot-green' }, status: 'done' } }).then((c) => c > 0));
    }
    verdict('pivot.catchup-green', greened && triggerDone, greened ? 'bouton passé au VERT ACTIF (surface:act) après reboot, trigger rattrapé' : `greened=${greened} done=${triggerDone}`);
  }

  // CLEANUP : surface + message + triggers.
  const surfaceRow = await prisma((p) => p.interactiveSurface.findUnique({ where: { id: surfaceId } }));
  if (surfaceRow?.messageId) await rest(`/channels/${channelId}/messages/${surfaceRow.messageId}`, { method: 'DELETE' }).catch(() => {});
  await prisma((p) => p.scheduledTrigger.updateMany({ where: { surfaceId }, data: { status: 'cancelled' } }));
  await prisma((p) => p.interactiveSurface.deleteMany({ where: { id: surfaceId } }));

  const passCount = results.filter((r) => r.pass).length;
  console.log(`[SUMMARY] ${passCount}/${results.length} PASS`);
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((error) => {
  console.error('[FAIL]', error.message);
  process.exit(1);
});
