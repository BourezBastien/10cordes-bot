# Audit 04 — Dashboard & scripts

## 1. Dashboard (`apps/dashboard`, 19 fichiers TS/TSX)

Stack : Vite 8 + React 19 + Tailwind 4 + TanStack (Router/Query/Table) + shadcn/ui + Aceternity.

**Design credit** : le langage graphique (dark, hiérarchie par accents, structure des vues) est fortement inspiré d'[ARCHIVE-9](https://github.com/LeoBdt/ARCHIVE-9) — pas une copie, un emprunt délibéré du style. Patterns secondaires : TailAdmin Pro (charts/empty states), Tenkai (tokens). Tokens : canvas `#111114`, surface `#19191E`, accent orange `#d95926` (branding) / vert `#72C99B` (série charts), zéro ombre sur surfaces, petits radius.

**Endpoints consommés** (API same-process, `@spraxium/http`) :
- `GET /api/v1/guilds/:id` (+members), `GET /:id/stats` (audit 14 j, cases, topXp **vide par design** depuis la purge levels — compat colonne dashboard), `GET /:id/modules` + `PATCH` (toggle).
- `POST /:id/agent/chat` : mêmes tools/gates que Discord, permissions = celles du membre lié (WebAgentService : session → snowflake via Account).
- Auth : better-auth + Discord OAuth ; guards par contrôleur (SessionGuard + GuildAccessGuard ; /legal et /api/auth publics).

## 2. Scripts (apps/bot/scripts, 9 fichiers)

| Script | Rôle |
|---|---|
| `arch-audit.mjs` | audit POO (5 règles, exit 1 si violations) — `pnpm arch:audit` |
| `sync-tool-names.mjs` | régénère `REGISTERED_TOOL_NAMES` depuis `git ls-files` (bloque `pnpm verify` si drift) |
| `check-modules.mjs` | cohérence dossiers modules ↔ catalogues (25 dossiers OK) |
| `diagnose.mjs [jours]` | forensique JSONL : top erreurs, LLM p95, tools les plus lents |
| `e2e-gate.mjs` | gate : webhooks, mentions, liens GitHub, zone libre |
| `e2e-features4.mjs` | primitives : **surface.create runTool** (définition persistée), members.pickRandom, sondage composé (surface + component_votes + dépouille records.search/patchState), records.counter, audit channel.created/deleted, skills sans fantômes |
| `e2e-surface.mjs` | pivot moteur : surface + trigger + **reboot en cours de timer** (catchup) |
| `tool-evals.mjs` | 8 prompts canoniques |
| `guardian.mjs` | daemon silencieux (healthz) |

**Supprimés en C1** : `e2e-features/2/3.mjs`, `e2e-write.mjs` (testaient des tools purgés : sendPanel, ticket.priority, invites.*, levels.*). `e2e-features4` a été migré sendPanel → surface.create/patchState.

## 3. CI / vérification

`pnpm verify` = lint → typecheck → test → build → check:modules → arch:audit. Tous verts au 23/11/2026 15:05 : 20 tests (7 curator + 13 shared), 0 erreur lint, 60 violations arch-audit connues (voir 05).

## 4. Logs & observabilité

- `logs/bot-YYYY-MM-DD.jsonl` : chaque événement (gate accept/ignored, tools, surfaces, triggers, exceptions avec stack).
- `logs/llm.jsonl` : cause, modèle, tokens, latence, ok — base du rapport coûts (blueprint llm-cost-monthly-report).
- Rotation quotidienne + garde-fou 10 Mo + purge >7 fichiers.

## 5. Dettes

- Dashboard : la page stats doit retirer la colonne topXp (ou l'étiquer « bientôt : activité ») puisque le endpoint renvoie un tableau vide.
- 19 fichiers : la couche est un scaffolding — les vues métier arrivent avec la Phase 4.
