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
| `DISCORD_TOKEN` | **OUI** | — | Token du bot (portail développeur) |
| `DATABASE_URL` | non | `file:../data/bot.db` | SQLite local ou PostgreSQL |
| `REDIS_URL` | non | (vide = mémoire) | Queue durable + cache temps réel. `redis://redis:6379` en prod |
| `PORT` | non | `3000` | Port du serveur HTTP |
| `HTTP_HOST` | non | `127.0.0.1` | Bind HTTP. `0.0.0.0` en Docker |
| `DASHBOARD_ORIGIN` | non | `http://localhost:5173` | Origine CORS du dashboard |
| `HTTP_API_KEY` | non | — | Clé API header `x-api-key` |
| `BETTER_AUTH_SECRET` | non | — | Min 32 chars, requis pour le dashboard |
| `DISCORD_CLIENT_SECRET` | non | — | OAuth Discord pour le login dashboard |
| `ENCRYPTION_SECRET` | non | dérivé | Chiffrement AES-256-GCM des clés en DB |
| `LLM_API_URL` | non | — | Base URL compatible OpenAI (bootstrap) |
| `LLM_API_KEY` | non | — | Clé API du fournisseur LLM (bootstrap) |
| `LLM_MODEL` | non | — | Nom du modèle (bootstrap) |
| `LLM_EFFORT` | non | (vide) | Effort de raisonnement : low/medium/high |
| `E2E_ENABLED` | non | `false` | Active les rigs de test (développement) |

### Connecter le fournisseur IA

**Deux façons** (la seconde prime sur la première) :
1. **Bootstrap par env** : remplis `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL`
   dans `.env` — n'importe quel fournisseur compatible OpenAI marche.
2. **Depuis Discord** : parle au bot sans clé configurée, un bouton
   « Connecter l'IA » apparaît ; clique, remplis la modale (URL + clé +
   modèle), test de connexion immédiat.

Les autres intégrations (PixelLab, kie.ai...) se connectent de la même
façon depuis Discord.

## Comment ça marche

- **Gate** : le bot répond uniquement s'il est mentionné (`@bot`), si on
  répond à un de ses messages, ou dans le salon dédié IA. Les règles du
  serveur (`rules.set` par l'agent) ajoutent des zones libres (réponse sans
  mention) et la confirmation des actions destructives (boutons ✅/❌).
- **Exécution directe** : pas de plans ni de panneaux de confirmation.
  Chaque tool destructif re-vérifie les permissions, archive l'état
  d'origine, audite tout.
- **Réponses** : texte simple dans le salon de la demande, en réponse au
  message d'origine. Streaming progressif (édition à 1,8 s minimum).
- **Mémoire** : fiches consolidées par membre et par serveur (curator LLM
  avec gardes anti-wipe). « Oublie-moi » purge tout et pose un opt-out.
- **Règles serveur** (`GuildRule`) : zones libres, mention stricte ailleurs,
  ton sérieux, confirmation des destructifs, instructions libres — le tout
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
  auth/                better-auth + guards
  modules/
    assistant/         agent conversationnel (gate, boucle LLM, streaming)
    surface/           moteur générique (surfaces, triggers, événements)
    rules/             règles serveur (GuildRule)
    agent/             tools discord.*, skills
    records/           store typé (collections Zod)
    memory/            fiches + curator + opt-out
    moderation/ logging/ tickets/ ...   modules techniques
  shared/              UI V2, cache temps réel, safe-fetch, crypto
packages/shared/       schémas Zod, contrats BotTool, SkillBlueprint
apps/dashboard/        dashboard web (React 19, Vite 8)
```

## Docker

```bash
docker compose up -d
```

Le `Dockerfile` build le bundle Spraxium, copie la config, et lance
`.spraxium/dist/src/main.mjs`. `HTTP_HOST=0.0.0.0` est posé par le compose.
