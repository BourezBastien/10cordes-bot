/**
 * Rig FOURNISSEURS (moteur multi-fournisseurs, 24/11) : vérifie en live, UNE
 * exécution, E2E_ONLY filtrable :
 *  1. providers.migrated : une conversation part bien du modèle routé du serveur
 *     (fournisseur créé par la migration de l'instance)
 *  2. providers.list     : provider.list et capability.list répondent ok, en langage naturel
 *  3. providers.test     : provider.test contrôle la connexion et charge le catalogue
 *  4. providers.rebind   : changement de modèle de la conversation par langage
 *     naturel, effet immédiat sur le tour suivant, puis restauration
 *  5. providers.fallback : fournisseur principal injoignable, bascule
 *     automatique sur le fournisseur de repli, réponse livrée
 *  6. providers.panel    : le panneau « Fournisseurs et modèles » est posté dans
 *     le fil privé, menus compris (le clic lui-même exige une interaction réelle)
 * Vérification : lignes d'audit assistant.tool.* (metadata.ok, jamais le nom
 * seul) et journal llm.jsonl depuis le watermark. Tout ce qui est modifié
 * (routes, fournisseur de test, mode thinking) est restauré.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BOT_DIR = resolve(SCRIPT_DIR, '..');
const API = 'https://discord.com/api/v10';
const STAFF_HOOK_NAME = 'agent-e2e-guardian';
const COOLDOWN_MS = 5_000;
const REPLY_WAIT_MS = 150_000;
/** Le bot garde ses routes en cache 30 s : délai laissé à une restauration directe en base. */
const ROUTE_CACHE_MS = 35_000;
/** Fournisseur de test : hôte de documentation (RFC 5737), jamais joignable. */
const PROBE_SLUG = 'e2e-noir';
const PROBE_URL = 'https://192.0.2.1/v1';
const PROBE_KEY = 'e2e-noir-cle-fictive-00000000';

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
const snowflakeTs = (id) => Number(BigInt(id) >> 22n) + 1_420_070_400_000;

let prisma;
let botId;
let guildId;
let staffHook;
let original;
/** État de référence de la restauration et du contrôle final. */
let reference = null;
const results = [];
const verdict = (name, pass, note = '') => {
  results.push({ name, pass });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${pass && !note ? '' : ` : ${note}`}`);
};
const skip = (name, note) => {
  results.push({ name, pass: true });
  console.log(`[SKIP] ${name} : ${note}`);
};

/** Attend qu'une condition sur la base ou le journal devienne vraie. */
async function waitFor(check, maxMs) {
  const start = Date.now();
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() - start > maxMs) return null;
    await sleep(3_000);
  }
}

/** Dernière ligne d'audit d'une action depuis un instant. */
function auditSince(since, action) {
  return prisma.auditLog.findFirst({ where: { createdAt: { gt: since }, action }, orderBy: { createdAt: 'desc' } });
}

/** Contenu d'une ligne d'audit : la base le garde en texte JSON. */
function metadataOf(row) {
  if (!row) return {};
  try {
    const parsed = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Envoie une demande au bot et attend qu'elle soit soldée (réponse ou erreur).
 *  Une demande de pure conversation n'évoque jamais les fournisseurs : ce mot
 *  fait router leurs tools, et la demande passe alors pour une action (route de raisonnement). */
async function ask(content, maxMs = REPLY_WAIT_MS) {
  await sleep(COOLDOWN_MS);
  const since = new Date(Date.now() - 1_000);
  await rest(`/webhooks/${staffHook.id}/${staffHook.token}?wait=true`, {
    method: 'POST',
    body: JSON.stringify({ content: `<@${botId}> ${content}`, allowed_mentions: { parse: [] } }),
  });
  const settled = await waitFor(() => auditSince(since, 'assistant.reply').then((row) => row ?? auditSince(since, 'assistant.error')), maxMs);
  return { since, settled: settled?.action ?? null };
}

/** Un tool a-t-il réussi pendant une demande ? (metadata.ok : le nom seul ne prouve rien) */
async function toolOk(since, name) {
  const metadata = metadataOf(await auditSince(since, `assistant.tool.${name}`));
  return { ok: metadata.ok === true, summary: String(metadata.summary ?? 'tool non appelé').slice(0, 160) };
}

/** Tours de conversation depuis un instant, lisibles : capacité/fournisseur/modèle. */
const turnsText = (turns) => turns.map((entry) => `${entry.capability ?? '?'}:${entry.provider ?? '?'}/${entry.model}${entry.fallback ? ' (repli)' : ''}`).join(', ') || 'aucun tour journalisé';

/** État des fournisseurs et des routes du serveur. */
async function snapshot() {
  const providers = await prisma.guildProvider.findMany({
    where: { guildId },
    select: { id: true, slug: true, protocol: true, enabled: true, cachedModelsJson: true },
  });
  const routes = await prisma.capabilityRoute.findMany({ where: { guildId } });
  const slugOf = (id) => providers.find((provider) => provider.id === id)?.slug ?? '(supprimé)';
  return {
    providers,
    routes,
    chatRoutes: routes.filter((route) => route.capability.startsWith('chat.')),
    describe: () => routes.map((route) => `${route.capability}=${slugOf(route.providerId)}/${route.modelId}${route.fallbackProviderId ? ` (repli ${slugOf(route.fallbackProviderId)})` : ''}`).join(' ; ') || 'aucune route',
  };
}

function llmSince(since) {
  const path = resolve(BOT_DIR, 'logs/llm.jsonl');
  if (!existsSync(path)) return [];
  const sinceIso = since.toISOString();
  return readFileSync(path, 'utf8')
    .split('\n')
    .slice(-400)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && entry.ts >= sinceIso);
}

async function thinkingMode() {
  const row = await prisma.guildAgentSettings.findUnique({ where: { guildId } });
  return row?.thinkingMode ?? 'adaptive';
}

/** Restaure l'état d'origine : d'abord par le bot (audité), sinon directement en base. */
async function restore(original) {
  const notes = [];
  const probe = await prisma.guildProvider.findFirst({ where: { guildId, slug: PROBE_SLUG } });
  if (probe) {
    await ask(`e2e-fournisseurs : supprime le fournisseur ${PROBE_SLUG} avec provider.delete. Réponds en une ligne.`, 60_000);
    if (await prisma.guildProvider.findFirst({ where: { guildId, slug: PROBE_SLUG } })) {
      await ask(`e2e-fournisseurs : oui, je confirme la suppression du fournisseur ${PROBE_SLUG}.`, 60_000);
    }
    if (await prisma.guildProvider.findFirst({ where: { guildId, slug: PROBE_SLUG } })) {
      await prisma.guildProvider.deleteMany({ where: { guildId, slug: PROBE_SLUG } });
      notes.push('fournisseur de test supprimé en base');
    } else {
      notes.push('fournisseur de test supprimé par provider.delete');
    }
  }
  const slugOf = (id) => original.providers.find((provider) => provider.id === id)?.slug ?? null;
  for (const capability of ['chat.default', 'chat.reasoning']) {
    const wanted = original.routes.find((route) => route.capability === capability);
    if (!wanted) continue;
    const isOriginal = (route) => route && route.providerId === wanted.providerId && route.modelId === wanted.modelId && !route.fallbackProviderId;
    const currentRoute = async () => (await snapshot()).routes.find((route) => route.capability === capability);
    if (isOriginal(await currentRoute())) continue;
    const slug = slugOf(wanted.providerId);
    const bound =
      slug &&
      (
        await ask(
          `e2e-fournisseurs : avec capability.bind, règle la capacité ${capability} sur le modèle ${wanted.modelId} du fournisseur ${slug}, sans fournisseur de repli. Réponds en une ligne.`,
          60_000,
        ).then((answer) => toolOk(answer.since, 'capability.bind'))
      ).ok;
    if (isOriginal(await currentRoute())) {
      notes.push(`route ${capability} restaurée par capability.bind (${bound ? 'ok' : 'non tracé'})`);
    } else {
      await prisma.capabilityRoute.upsert({
        where: { guildId_capability: { guildId, capability } },
        create: { guildId, capability, providerId: wanted.providerId, modelId: wanted.modelId },
        update: { providerId: wanted.providerId, modelId: wanted.modelId, fallbackProviderId: null, fallbackModelId: null },
      });
      notes.push(`route ${capability} restaurée en base`);
    }
  }
  if ((await thinkingMode()) !== original.thinkingMode) {
    const back = await ask(`e2e-fournisseurs : remets le mode thinking de ce serveur sur ${original.thinkingMode} avec config.thinking. Réponds en une ligne.`, 60_000);
    if ((await thinkingMode()) !== original.thinkingMode) {
      await prisma.guildAgentSettings.update({ where: { guildId }, data: { thinkingMode: original.thinkingMode } });
      notes.push('mode thinking restauré en base (redémarrage du bot requis)');
    } else {
      notes.push(`mode thinking restauré par config.thinking (${(await toolOk(back.since, 'config.thinking')).ok ? 'ok' : 'non tracé'})`);
    }
  }
  return notes;
}

async function main() {
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',').map((s) => s.trim()) : null;
  const runs = (name) => !only || only.includes(name);
  console.log(`[E2E-fournisseurs] démarrage ${new Date().toISOString()} (E2E_ONLY=${process.env.E2E_ONLY ?? '-'})`);

  botId = (await rest('/users/@me')).id;
  guildId = env.E2E_GUILD_ID;
  if (!guildId || !(await rest('/users/@me/guilds')).some((guild) => guild.id === guildId)) {
    throw new Error(`E2E_GUILD_ID=${guildId ?? '(absent)'} : bot absent du serveur`);
  }
  const { createDatabaseClient } = await import('../src/modules/database/database-client.ts');
  prisma = createDatabaseClient(process.env.DATABASE_URL);

  let original;
  try {
    let channelId;
    try {
      const guild = await prisma.guild.findUnique({ where: { id: guildId }, select: { settings: true } });
      channelId = guild?.settings ? JSON.parse(guild.settings)?.assistant?.channelId ?? null : null;
    } catch {
      channelId = null;
    }
    if (!channelId) throw new Error('aucun salon dédié IA');
    const hooks = await rest(`/channels/${channelId}/webhooks`);
    staffHook = hooks.find((hook) => hook.name === STAFF_HOOK_NAME && hook.user?.id === botId);
    if (!staffHook) staffHook = await rest(`/channels/${channelId}/webhooks`, { method: 'POST', body: JSON.stringify({ name: STAFF_HOOK_NAME }) });
    console.log(`[E2E-fournisseurs] serveur ${guildId}, salon ${channelId}`);

    const initial = await snapshot();
    const initialThinking = await thinkingMode();
    original = { ...initial, thinkingMode: initialThinking };
    console.log(`[E2E-fournisseurs] état initial : ${initial.describe()} · thinking ${initialThinking}`);

    try {
      // L'état de référence de la restauration est pris APRÈS le scénario de
      // migration : avant, le serveur peut n'avoir aucune route. Un rig
      // restaure l'état de marche qu'il a trouvé, pas un état vide.
      reference = initial;

      // ---- 1. La conversation part du modèle routé du serveur ----
      if (runs('providers.migrated')) {
        const answer = await ask('e2e : réponds exactement « sonnette-ok » et rien d\'autre.');
        const state = await snapshot();
        const turns = llmSince(answer.since);
        const routed = turns.filter((entry) => entry.provider && state.providers.some((provider) => provider.slug === entry.provider));
        const pass = answer.settled === 'assistant.reply' && state.chatRoutes.length >= 1 && routed.length >= 1;
        const firstMigration = original.providers.length === 0 && state.providers.length > 0;
        verdict(
          'providers.migrated',
          pass,
          pass
            ? `${routed.length} tour(s) : ${turnsText(routed)} ; ${firstMigration ? 'migration de l\u0027instance pendant ce scénario' : 'fournisseurs déjà migrés'} ; routes : ${state.describe()}`
            : `soldé=${answer.settled} routes=${state.chatRoutes.length} tours=${turnsText(turns)}`,
        );
      }
      reference = await snapshot();

      const state = reference;
      const defaultRoute = state.routes.find((route) => route.capability === 'chat.default');
      const main = state.providers.find((provider) => provider.id === defaultRoute?.providerId);
      const currentModel = defaultRoute?.modelId ?? null;
      if (!main || !currentModel) {
        skip('providers.list', 'aucune route de conversation sur ce serveur');
        skip('providers.test', 'aucune route de conversation sur ce serveur');
        skip('providers.rebind', 'aucune route de conversation sur ce serveur');
        skip('providers.fallback', 'aucune route de conversation sur ce serveur');
      } else {
        // ---- 2. Inventaire en langage naturel ----
        if (runs('providers.list')) {
          const listed = await ask('e2e-fournisseurs : quels fournisseurs IA sont configurés sur ce serveur ? Utilise provider.list et réponds en une ligne.');
          const list = await toolOk(listed.since, 'provider.list');
          const caps = await ask('e2e-fournisseurs : quel modèle exécute chaque capacité de ce serveur ? Utilise capability.list et réponds en une ligne.');
          const routes = await toolOk(caps.since, 'capability.list');
          verdict('providers.list', list.ok && routes.ok, `provider.list ${list.ok ? 'ok' : `échec (${list.summary})`} · capability.list ${routes.ok ? 'ok' : `échec (${routes.summary})`}`);
        }

        // ---- 3. Contrôle de connexion et catalogue ----
        let catalog = [];
        if (runs('providers.test')) {
          const tested = await ask(`e2e-fournisseurs : teste la connexion du fournisseur ${main.slug} avec provider.test et dis-moi combien de modèles il propose.`);
          const test = await toolOk(tested.since, 'provider.test');
          catalog = JSON.parse((await snapshot()).providers.find((provider) => provider.id === main.id)?.cachedModelsJson ?? '[]');
          verdict('providers.test', test.ok && catalog.length > 0, test.ok ? `${catalog.length} modèle(s) au catalogue de ${main.slug}` : `échec (${test.summary})`);
        } else {
          catalog = JSON.parse(main.cachedModelsJson ?? '[]');
        }

        // ---- 4. Changement de modèle de la conversation ----
        const other = catalog.find((model) => model.id !== currentModel && (!model.kind || model.kind === 'chat'))?.id ?? null;
        if (!runs('providers.rebind')) {
          // filtré
        } else if (!other) {
          skip('providers.rebind', `aucun autre modèle de conversation dans le catalogue de ${main.slug}`);
        } else {
          // Routes liées : raisonnement et ingestion qui partagent le modèle de la conversation suivent son changement.
          const head = state.routes.find((route) => route.capability === 'chat.default');
          const linked = ['chat.reasoning', 'chat.ingestion'].filter((capability) => {
            const sibling = state.routes.find((route) => route.capability === capability);
            return sibling && head && sibling.providerId === head.providerId && sibling.modelId === head.modelId && !sibling.fallbackProviderId;
          });
          const bound = await ask(`e2e-fournisseurs : avec capability.bind, règle la capacité chat.default de ce serveur sur le modèle ${other} du fournisseur ${main.slug}. Réponds en une ligne.`);
          const bind = await toolOk(bound.since, 'capability.bind');
          const after = await snapshot();
          const rebound = after.routes.find((route) => route.capability === 'chat.default');
          const followersMoved = linked.every((capability) => {
            const route = after.routes.find((entry) => entry.capability === capability);
            return route && route.providerId === rebound?.providerId && route.modelId === other;
          });
          const talked = await ask('e2e : réponds exactement « rebind-ok » et rien d\'autre.');
          const turns = llmSince(talked.since);
          // Le tour suivant porte le nouveau modèle, quelle que soit la route de conversation empruntée.
          const applied = bind.ok && rebound?.modelId === other && followersMoved && turns.some((entry) => entry.model === other && entry.provider === main.slug);
          verdict(
            'providers.rebind',
            applied,
            applied
              ? `chat.default sur ${other}${linked.length > 0 ? ` (${linked.join(', ')} liées : elles ont suivi)` : ''} : ${turnsText(turns)} ; restauration en cours`
              : `bind ${bind.ok ? 'ok' : `échec (${bind.summary})`}, route=${rebound?.modelId ?? 'absente'}, routes liées suivies=${followersMoved}, tours=${turnsText(turns)}`,
          );

          // Retour à l'état de référence : les routes liées reviennent avec la conversation par défaut.
          const back = await ask(`e2e-fournisseurs : avec capability.bind, règle la capacité chat.default sur le modèle ${currentModel} du fournisseur ${main.slug}. Réponds en une ligne.`);
          console.log(`[CLEANUP] retour du modèle de conversation : ${(await toolOk(back.since, 'capability.bind')).summary}`);
        }

        // ---- 5. Fournisseur principal injoignable : bascule sur le repli ----
        if (runs('providers.fallback')) {
          const always = await ask('e2e-fournisseurs : passe le mode thinking de ce serveur sur always avec config.thinking. Réponds en une ligne.');
          const upserted = await ask(
            `e2e-fournisseurs : test automatisé. Utilise l'outil provider.upsert directement (ne propose pas le panneau) pour ajouter un fournisseur : slug ${PROBE_SLUG}, protocole openai-chat, baseUrl ${PROBE_URL}, apiKey ${PROBE_KEY}. S'il est injoignable, c'est voulu. Réponds en une ligne.`,
          );
          const probe = await prisma.guildProvider.findFirst({ where: { guildId, slug: PROBE_SLUG } });
          const bound = await ask(
            `e2e-fournisseurs : avec capability.bind, règle la capacité chat.reasoning sur le fournisseur ${PROBE_SLUG} avec le modèle x, et mets le fournisseur ${main.slug} avec le modèle ${currentModel} en fournisseur de repli. Réponds en une ligne.`,
          );
          const route = (await snapshot()).routes.find((entry) => entry.capability === 'chat.reasoning');
          const routeOk = route?.modelId === 'x' && (await snapshot()).providers.find((provider) => provider.id === route.providerId)?.slug === PROBE_SLUG && route.fallbackProviderId === main.id;
          const talked = await ask('e2e : réponds exactement « repli-ok » et rien d\'autre.');
          const fallback = await prisma.auditLog.findFirst({
            where: { createdAt: { gt: talked.since }, action: 'capability.fallback' },
            orderBy: { createdAt: 'desc' },
          });
          const fallbackMeta = metadataOf(fallback);
          const turns = llmSince(talked.since);
          const served = turns.filter((entry) => entry.provider === main.slug && entry.fallback === true);
          const pass = Boolean(probe && routeOk && fallback && talked.settled === 'assistant.reply' && served.length >= 1);
          verdict(
            'providers.fallback',
            pass,
            pass
              ? `${served.length} tour(s) servi(s) par le repli : ${turnsText(served)} (principal ${PROBE_SLUG} injoignable) ; audit ${fallbackMeta.from} → ${fallbackMeta.to}`
              : `fournisseur=${Boolean(probe)} route=${routeOk ? 'ok' : 'ko'} repli=${fallback ? `${fallbackMeta.from}→${fallbackMeta.to}` : 'non tracé'} soldé=${talked.settled} tours=${turnsText(turns)} · thinking:${(await toolOk(always.since, 'config.thinking')).summary} upsert:${(await toolOk(upserted.since, 'provider.upsert')).summary} bind:${(await toolOk(bound.since, 'capability.bind')).summary}`,
          );
        }
      }

      // ---- Restauration, puis panneau sur l'état de référence ----
      const notes = await restore({ ...reference, thinkingMode: initialThinking });
      console.log(`[CLEANUP] ${notes.length > 0 ? notes.join(' ; ') : 'rien à restaurer'}`);
      await sleep(ROUTE_CACHE_MS);

      if (runs('providers.panel')) {
        const opened = await ask('e2e-fournisseurs : ouvre le panneau « Fournisseurs et modèles » avec providers.panel.');
        const panel = await toolOk(opened.since, 'providers.panel');
        const shown = await ask('e2e-fournisseurs : montre-moi la configuration de ce serveur avec config.panel.');
        const config = await toolOk(shown.since, 'config.panel');
        const threadId = (await prisma.guildAgentSettings.findUnique({ where: { guildId } }))?.configThreadId;
        const messages = threadId ? await rest(`/channels/${threadId}/messages?limit=15`).catch(() => []) : [];
        const sinceTs = opened.since.getTime();
        const fresh = messages.filter((message) => message.author.id === botId && snowflakeTs(message.id) >= sinceTs - 2_000);
        const serialized = JSON.stringify(fresh);
        // Les menus et le bouton du panneau : préfixes des customIds (le suffixe d'état dépend de la sélection).
        const hubParts = ['provider:select', 'provider:capability', 'provider:model', 'provider:add'].filter((prefix) => serialized.includes(prefix));
        const pass = panel.ok && hubParts.length === 4 && config.ok && serialized.includes('Fournisseurs et modèles de ce serveur');
        verdict(
          'providers.panel',
          pass,
          pass
            ? `panneau posté dans <#${threadId}> : ${hubParts.length} composants retrouvés, bloc fournisseurs dans le panneau de configuration`
            : `providers.panel ${panel.ok ? 'ok' : `échec (${panel.summary})`} · config.panel ${config.ok ? 'ok' : `échec (${config.summary})`} · composants ${hubParts.length}/4 (${hubParts.join(', ')}) · bloc fournisseurs=${serialized.includes('Fournisseurs et modèles de ce serveur')} · fil ${threadId ?? 'introuvable'}`,
        );
      }
    } finally {
      const after = await snapshot();
      const final = { routes: after.routes, thinkingMode: await thinkingMode() };
      const probeLeft = after.providers.some((provider) => provider.slug === PROBE_SLUG);
      const wanted = reference?.routes ?? [];
      const routesBack =
        wanted.every((route) => {
          const now = final.routes.find((entry) => entry.capability === route.capability);
          return now && now.providerId === route.providerId && now.modelId === route.modelId && !now.fallbackProviderId;
        }) && !final.routes.some((route) => !wanted.some((entry) => entry.capability === route.capability && entry.providerId === route.providerId));
      const clean = !probeLeft && routesBack && final.thinkingMode === original?.thinkingMode;
      console.log(`[CLEANUP] état final : ${after.describe()} · thinking ${final.thinkingMode} · ${clean ? 'identique à l\u0027état de référence' : 'DIFFÈRE DE L\u0027ÉTAT DE RÉFÉRENCE'}`);
      if (!clean) results.push({ name: 'providers.cleanup', pass: false });
    }
  } finally {
    await prisma.$disconnect();
  }

  const passCount = results.filter((r) => r.pass).length;
  console.log(`[SUMMARY] ${passCount}/${results.length} PASS`);
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((error) => {
  console.error('[FAIL]', error.message);
  process.exit(1);
});
