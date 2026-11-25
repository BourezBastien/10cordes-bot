# 10cordes-bot

Un agent Discord conversationnel : **zéro commande slash**, tout par le
langage naturel. Mentionne le bot, il agit.

## Démarrage rapide

```bash
# 1. Cloner et installer
pnpm install

# 2. Configurer l'environnement (une seule variable requise)
cp apps/bot/.env.example apps/bot/.env
# Édite .env : DISCORD_TOKEN=...

# 3. Activer le MESSAGE CONTENT privileged intent sur le portail développeur Discord

# 4. Lancer
pnpm dev          # développement (hot reload)
pnpm build        # build production -> .spraxium/dist
pnpm start        # production
```

**Jamais** `node .spraxium/dist/src/main.mjs` directement : le ConfigLoader
relit `spraxium.config.ts` et l'import ESM nu échoue.

## Variables d'environnement

| Variable | Requise | Défaut | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | **OUI** | (aucun) | Token du bot (portail développeur) |
| `DATABASE_URL` | non | `file:../data/bot.db` | SQLite local ou PostgreSQL |
| `REDIS_URL` | non | (vide = mémoire) | Queue durable + cache temps réel. `redis://redis:6379` en prod |
| `PORT` | non | `3000` | Port du serveur HTTP |
| `HTTP_HOST` | non | `127.0.0.1` | Bind HTTP. `0.0.0.0` en Docker |
| `DASHBOARD_ORIGIN` | non | `http://localhost:5173` | Origines admises du tableau de bord, séparées par des virgules (CORS, contrôle d'origine des écritures, login). La première porte l'adresse de rappel du login Discord |
| `DASHBOARD_DIST_DIR` | non | (aucun) | Dossier du tableau de bord compilé (`../dashboard/dist`) : le bot le sert sur sa propre origine |
| `HTTP_API_KEY` | non | (aucun) | Clé de la sonde `/healthz` seule (header `x-api-key`). L'API du tableau de bord s'authentifie par la session |
| `BETTER_AUTH_SECRET` | non | (aucun) | Min 32 chars ; derive aussi la clé maîtresse du chiffrement. Requis pour le tableau de bord |
| `DISCORD_CLIENT_ID` | non | (aucun) | Identifiant OAuth Discord du bot (login du tableau de bord) |
| `DISCORD_CLIENT_SECRET` | non | (aucun) | Secret OAuth Discord pour le login du tableau de bord |
| `ENCRYPTION_SECRET` | non | dérivé | Chiffrement AES-256-GCM des clés en DB |
| `LLM_API_URL` | non | (aucun) | Base URL compatible OpenAI (bootstrap) |
| `LLM_API_KEY` | non | (aucun) | Clé API du fournisseur LLM (bootstrap) |
| `LLM_MODEL` | non | (aucun) | Nom du modèle (bootstrap) |
| `LLM_EFFORT` | non | (vide) | Effort de raisonnement : low/medium/high |
| `E2E_ENABLED` | non | `false` | Active les rigs de test (développement) |

### Connecter le fournisseur IA

**Deux façons** (la seconde prime sur la première) :
1. **Bootstrap par env** : remplis `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL`
   dans `.env` : n'importe quel fournisseur compatible OpenAI marche.
2. **Depuis Discord** : parle au bot sans clé configurée, un bouton
   « Connecter l'IA » apparaît ; clique, remplis la modale (URL + clé +
   modèle), test de connexion immédiat.

Les autres intégrations (PixelLab, kie.ai...) se connectent de la même
façon depuis Discord.

### Tableau de bord web

Le tableau de bord (`apps/dashboard`) parle à l'API du bot. Deux façons de
l'ouvrir :

1. **En développement** : `pnpm --filter 10cordes-dashboard dev`, puis
   <http://localhost:5173>. Vite relaie `/api` vers le bot (cible par
   `API_PROXY_TARGET`, `http://127.0.0.1:3000` par défaut).
2. **Compilé, servi par le bot** : `pnpm --filter 10cordes-dashboard build`,
   puis `DASHBOARD_DIST_DIR=../dashboard/dist` dans l'environnement du bot.
   Le tableau de bord et l'API partagent alors la même origine
   (`http://127.0.0.1:3000`). Sans ce réglage, le bot ne sert aucune page.
   Réglez dans le même temps `DASHBOARD_ORIGIN=http://127.0.0.1:3000` : le
   login n'accepte que les origines admises, et son rappel Discord suit la
   première.

Le login passe par Discord. Il demande trois variables :
`BETTER_AUTH_SECRET`, `DISCORD_CLIENT_ID` et `DISCORD_CLIENT_SECRET`. Tant
que l'une manque, `/api/auth/*` répond 503 avec la cause, et le tableau de
bord renvoie à la page de connexion. Dans le portail développeur Discord,
l'adresse de rappel OAuth est la première origine de `DASHBOARD_ORIGIN`
suivie de `/api/auth/callback/discord`. Seul le droit `identify` est
demandé, et les jetons OAuth sont abandonnés dès que le compte est lié.

Ce que l'API garantit : chaque route d'un serveur reverifie à chaque appel
que le membre connecté fait toujours partie du serveur et peut le gérer ;
aucune clé ne ressort (seuls `hasApiKey` et un indice) ; une clé vide lors
d'une mise à jour conserve celle en place ; une écriture vient d'une
origine admise ; rien ne se met en cache ni ne s'indexe.

## Comment ça marche

- **Gate** : le bot répond uniquement s'il est mentionné (`@bot`), si on
  répond à un de ses messages, ou dans le salon dédié IA. Les règles du
  serveur (`rules.set` par l'agent) ajoutent des zones libres (réponse sans
  mention) et la règle « Confirmer les actions (hors lecture) » (boutons ✅/❌).
- **Exécution directe** : par défaut, pas de plans ni de panneaux de
  confirmation. Chaque tool destructif re-vérifie les permissions, archive
  l'état d'origine, audite tout.
- **Confirmer les actions (hors lecture)** : règle du serveur, désactivée
  par défaut. Une fois active, toute action qui modifie proposée par
  l'agent attend le clic du demandeur sur un panneau « Appliquer » /
  « Annuler » ; les lectures et la livraison d'un fichier passent. Chaque
  action est revérifiée au clic.
- **Réponses** : la réponse finale, envoyée une fois, en réponse au message
  d'origine (découpée en morceaux de 2 000 caractères au besoin). Rien
  d'autre n'est publié pendant le travail, sauf l'indicateur « écrit ».
- **Mémoire** : fiches consolidées par membre et par serveur (curator LLM
  avec gardes anti-wipe). « Oublie-moi » purge tout et pose un opt-out.
- **Règles serveur** (`GuildRule`) : zones libres, mention stricte ailleurs,
  ton sérieux, confirmer les actions (hors lecture), instructions libres : le tout
  en langage naturel via l'agent, appliqué en code ET dans le prompt.
- **Surfaces interactives** : `surface.create` construit n'importe quelle
  interface (boutons, menus, modals) avec état persistant, timers
  conditionnels (rattrapage garanti après reboot), et re-render automatique.
- **Routing des tools** : noyau petit + `search_tools` qui élargit le
  toolset à la volée (pattern Anthropic).

## Logging local (diagnostic)

Tout est enregistré en JSONL structuré :
- `logs/bot-YYYY-MM-DD.jsonl` : chaque événement (gate, tools, surfaces,
  triggers, intégrations, erreurs) avec horodatage et données.
- `logs/llm.jsonl` : chaque appel LLM (cause, tokens, latence, succès).

```bash
node scripts/diagnose.mjs        # résumé du jour : top erreurs, p95 LLM,
node scripts/diagnose.mjs 7      # 7 derniers jours
```

## Rigs de test (développement)

```bash
E2E_ENABLED=true dans .env, puis :
node scripts/e2e-gate.mjs         # gate : 5 scénarios (webhook, mention, etc.)
node scripts/e2e-features4.mjs    # primitives : vote, counter, audit
node scripts/tool-evals.mjs       # 8 prompts canoniques
node scripts/e2e-surface.mjs      # cas pivot : reboot pendant timer
```

Les webhooks de test sont créés par le bot lui-même (nommés
`agent-e2e-guardian`) et auto-reconnus quand `E2E_ENABLED=true`.

## Structure

```
apps/bot/src/
  main.ts              bootstrap + purge slash commands
  app.module.ts        arbre des modules
  app.env.ts           env typée (variables génériques)
  auth/                better-auth + gardes (session, accès à un serveur)
  modules/
    api/                API du tableau de bord (fournisseurs, capacités,
                        intégrations, connecteurs, règles, usage, flux temps
                        réel, panel compilé) et politique commune
    assistant/         agent conversationnel (gate, boucle LLM, streaming)
    webhooks/          connecteurs HTTP sortants (outil webhook.call)
    usage/             compte des appels au modèle, par serveur
    surface/           moteur générique (surfaces, triggers, événements)
    rules/             règles serveur (GuildRule)
    agent/             tools discord.*, skills
    records/           store typé (collections Zod)
    memory/            fiches + curator + opt-out
    moderation/ logging/ tickets/ ...   modules techniques
  shared/              UI V2, cache temps réel, safe-fetch, crypto
packages/shared/       schémas Zod, contrats BotTool, SkillBlueprint
apps/dashboard/        tableau de bord web (React 19, Vite 8, TanStack Router)
```

## Docker

```bash
docker compose up -d
```

Le `Dockerfile` build le bundle Spraxium, copie la config, et lance
`.spraxium/dist/src/main.mjs`. `HTTP_HOST=0.0.0.0` est posé par le compose.
