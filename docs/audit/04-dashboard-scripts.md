# Audit 04 · Dashboard & scripts

> Mesures du 23/11/2026 en fin de journée.

## 1. Dashboard (`apps/dashboard`, 19 fichiers TS/TSX)

Stack : Vite 8 + React 19 + Tailwind 4 + TanStack (Router, Query, Table) + shadcn/ui + Aceternity.

**Design** : le langage graphique (thème sombre, hiérarchie par accents, structure des vues) s'inspire fortement d'[ARCHIVE-9](https://github.com/LeoBdt/ARCHIVE-9). Ce n'est pas une copie : le style a été repris délibérément. Patterns secondaires : TailAdmin Pro (graphiques, états vides), Tenkai (tokens). Tokens : canvas `#111114`, surface `#19191E`, accent orange `#d95926` (marque), vert `#72C99B` (série de graphiques), aucune ombre sur les surfaces, petits rayons.

**Endpoints consommés** (API dans le même process, `@spraxium/http`) :
- `GET /api/v1/guilds/:id` (+ members), `GET /:id/stats` (audit 14 jours, cases ; `topXp` est vide par design depuis la purge des niveaux, pour ne pas casser la colonne du dashboard), `GET /:id/modules` et `PATCH` (activation).
- `POST /:id/agent/chat` : mêmes tools et mêmes portes que Discord, permissions = celles du membre lié (`WebAgentService` : session vers identifiant Discord via `Account`).
- Authentification : better-auth + Discord OAuth ; guards posés par contrôleur (`SessionGuard` + `GuildAccessGuard` ; `/legal` et `/api/auth` publics).

## 2. Scripts (`apps/bot/scripts`, 10 fichiers)

| Script | Rôle |
|---|---|
| `arch-audit.mjs` | audit d'architecture POO (6 règles). Strict par défaut (exit 1 dès une violation), mode cliquet avec `--baseline` |
| `arch-audit.baseline.json` | dette acceptée du cliquet : 60 violations sur 34 couples règle/fichier, à régénérer quand elle baisse |
| `sync-tool-names.mjs` | régénère `REGISTERED_TOOL_NAMES` depuis les littéraux de nom des sources trackées par Git |
| `check-modules.mjs` | cohérence dossiers de modules et catalogues (25 dossiers) |
| `diagnose.mjs [jours]` | forensique JSONL : principales erreurs, p95 LLM, tools les plus lents |
| `e2e-gate.mjs` | la gate : webhooks, mentions, liens GitHub, zone libre |
| `e2e-features4.mjs` | primitives : surface avec pipeline `runTool`, tirage aléatoire, sondage composé, compteur, audit d'événements |
| `e2e-surface.mjs` | pivot du moteur : surface + trigger + **redémarrage en cours de timer** (rattrapage) |
| `tool-evals.mjs` | 8 prompts canoniques |
| `e2e-full-suite.mjs` | 11 scénarios de conversation (`E2E_ONLY=nom` pour filtrer), journal `logs/e2e-suite-<guildId>.jsonl` |
| `guardian.mjs` | daemon silencieux (healthz) |

**Règle des rigs** : un tool ne compte que s'il a réussi (`ok: true` dans l'audit), et chaque échec de tool reste affiché dans la note du scénario. Les rigs ne regardaient auparavant que le nom du tool appelé : ils ont rapporté des PASS sur des tools en échec (voir `05-verification-anomalies.md`, anomalie 4).

## 3. CI et vérification

La CI (workflow `ci.yml`, contrôle requis « Lint · Modules · Typecheck · Test ») lance `check:modules`, `lint`, `typecheck` et `test`. Elle est verte sur `develop`.

`pnpm verify` (local) enchaîne lint, typecheck, test, build, check:modules, puis `arch:audit:ratchet`. Le cliquet fait échouer la vérification sur toute violation absente de la baseline. `pnpm arch:audit` seul reste strict et liste l'intégralité de la dette.

La CI n'exécute ni `build` ni l'audit d'architecture. Ajouter le cliquet au workflow protégerrait les règles d'architecture sur chaque push.

## 4. Logs et observabilité

- `logs/bot-YYYY-MM-DD.jsonl` : chaque événement (décisions de la gate, tools, surfaces, triggers, exceptions avec pile).
- `logs/llm.jsonl` : cause, modèle, tokens, latence, succès. Base du rapport de coûts (blueprint `llm-cost-monthly-report`).
- `logs/e2e-suite-<guildId>.jsonl` : journal forensique de la suite E2E (append-only, un `runId` par exécution).
- Rotation quotidienne, garde-fou de 10 Mo, purge au-delà de 7 fichiers.
- La table d'audit enregistre, pour chaque tool appelé par l'agent, la ligne `assistant.tool.<nom>` avec `ok` et le `summary` (donc le motif d'un échec).

## 5. Dettes

- Dashboard : la page de statistiques doit retirer la colonne `topXp`, le endpoint renvoie un tableau vide.
- 19 fichiers : la couche est un squelette, les vues métier arrivent avec la Phase 4.
- `scripts/guardian.mjs` peut sortir en code d'erreur non nul alors même qu'il a relancé le bot (sonde trop impatiente) ; le rig `e2e-surface` tolère désormais ce cas.
