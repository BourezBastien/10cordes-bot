# Audit 04 · Dashboard & scripts

> Mesures du 23/11/2026 en fin de journée.

## 1. Dashboard (`apps/dashboard`, 19 fichiers TS/TSX)

Stack : Vite 8 + React 19 + Tailwind 4 + TanStack (Router, Query, Table) + shadcn/ui + Aceternity.

**Design** : le langage graphique (thème sombre, hiérarchie par accents, structure des vues) s'inspire fortement d'[ARCHIVE-9](https://github.com/LeoBdt/ARCHIVE-9). Ce n'est pas une copie : le style a été repris délibérément. Patterns secondaires : TailAdmin Pro (graphiques, états vides), Tenkai (tokens). Tokens : canvas `#111114`, surface `#19191E`, accent orange `#d95926` (marque), vert `#72C99B` (série de graphiques), aucune ombre sur les surfaces, petits rayons.

**Endpoints consommés** (API dans le même process, `@spraxium/http`) :
- `GET /api/v1/guilds/:id` (+ members), `GET /:id/stats` (audit 14 jours, cases ; `topXp` est vide par design depuis la purge des niveaux, pour ne pas casser la colonne du dashboard), `GET /:id/modules` et `PATCH` (activation).
- `POST /:id/agent/chat` : mêmes tools et mêmes portes que Discord, permissions = celles du membre lié (`WebAgentService` : session vers identifiant Discord via `Account`).
- Authentification : better-auth + Discord OAuth ; guards posés par contrôleur (`SessionGuard` + `GuildAccessGuard` ; `/legal` et `/api/auth` publics).

## 2. Scripts (`apps/bot/scripts`, 9 fichiers, plus `scripts/check-modules.mjs` à la racine)

| Script | Rôle |
|---|---|
| `arch-audit.mjs` | audit d'architecture POO (6 règles), STRICT : exit 1 dès une violation, sans baseline ni cliquet. Fait partie de `pnpm verify` et de la CI |
| `sync-tool-names.mjs` | régénère `REGISTERED_TOOL_NAMES` depuis les littéraux de nom des sources trackées par Git (`--check` dans `pnpm verify`) |
| `check-modules.mjs` | cohérence dossiers de modules et catalogues (25 dossiers) |
| `diagnose.mjs [jours]` | forensique JSONL : principales erreurs, p95 LLM, tools les plus lents |
| `e2e-gate.mjs` | la gate : webhooks, mentions, liens GitHub, zone libre |
| `e2e-features4.mjs` | primitives : surface avec pipeline `runTool`, tirage aléatoire, sondage composé, compteur, audit d'événements |
| `e2e-surface.mjs` | pivot du moteur : surface + trigger + **redémarrage en cours de timer** (rattrapage) |
| `tool-evals.mjs` | 8 prompts canoniques |
| `e2e-full-suite.mjs` | 13 scénarios de conversation (`E2E_ONLY=nom` pour filtrer), journal `logs/e2e-suite-<guildId>.jsonl` |
| `guardian.mjs` | daemon silencieux (healthz) |

**Règle des rigs** : un tool ne compte que s'il a réussi (`ok: true` dans l'audit), et chaque échec de tool reste affiché dans la note du scénario. Les rigs ne regardaient auparavant que le nom du tool appelé : ils ont rapporté des PASS sur des tools en échec (voir `05-verification-anomalies.md`, anomalie 4).

**Webhooks de test** : un salon Discord accepte 15 webhooks au maximum. Le rig de gate crée un webhook « intrus » et le supprime à la fin ; un run interrompu le laissait derrière lui, et le salon IA du serveur de dév a fini saturé (23/11, 22 h). Le rig réutilise désormais le premier intrus trouvé et balaie les autres ; l'ancien harnais avait par ailleurs laissé 8 webhooks `agent-e2e-test`, supprimés.

## 3. CI et vérification

La CI (workflow `ci.yml`, contrôle requis « Lint · Modules · Typecheck · Test ») lance, dans l'ordre : `check:modules`, `arch:audit` (strict, 0 violation), `lint`, `typecheck`, `test`, puis `build` des trois workspaces. Une violation d'architecture casse donc le push. Le nom du job est le contrôle exigé par la protection des branches `main` et `develop` : il ne change pas quand on ajoute une étape.

`pnpm verify` (local) enchaîne lint, typecheck, test, build, check:modules, puis `arch:audit` en mode strict. Il n'y a plus de baseline ni de cliquet : une règle ne se contourne pas, le code se corrige.

**Limite connue** : `pnpm lint` n'applique aujourd'hui aucune règle aux fichiers TypeScript. `@bluzzi/eslint-config` n'active son module TypeScript que si le paquet `typescript` est résolu depuis la racine du monorepo, où pnpm ne l'installe pas (il vit dans `apps/bot` et `apps/dashboard`). La garantie du code TS repose donc sur `tsc`, vitest et `arch:audit`. Activer la config TypeScript telle quelle ferait apparaître environ 3 000 erreurs de style sur 175 fichiers : c'est une décision à prendre (accorder les règles aux conventions du dépôt, puis l'activer).

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
