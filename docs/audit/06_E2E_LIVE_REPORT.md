# Audit 06 — Rapport E2E live (serveur 1550835980116824136)

> Sessions du 23/11/2026 (14:03 → 16:08). Bot builds successifs post-Phase A/B/C/D + fixes du jour. Journal forensique : `apps/bot/logs/e2e-suite-1550835980116824136.jsonl` (append-only, runId par exécution).

## 1. Suite complète : 10 scénarios, 10/10 PASS

| # | Scénario | Vérification | Résultat |
|---|---|---|---|
| 1 | `gate.noise` | « HAHAHAHYA QUOI » en salon dédié → ignoré, **zéro appel LLM** (anti-bruit social) | ✅ |
| 2 | `rules.list` | question règles → lecture du store GuildRule (rules.list/server.overview) | ✅ |
| 3 | `server.overview` | « montre ta configuration » → vue APPLIQUÉE (règles/skills/intégrations), **pas de dump getConfig legacy** | ✅ |
| 4 | `config.panel` | fil privé **⚙️┃config-bot créé** + panneau V2 (ConfigPanelPresenter) | ✅ |
| 5 | `tickets.surface` | panneau tickets via surface.create kind=ticket (moteur générique, zéro handler dédié) | ✅ |
| 6 | `skills.voice` | recette vocaux temporaires → search_skills (135 blueprints) | ✅ |
| 7 | `skills.casino` | recette casino → search_skills | ✅ |
| 8 | `polls.compose` | surface 3 boutons + votes DB + clôture : patchState + **description avec résultats** + boutons désactivés | ✅ |
| 9 | `ingest.status` | statut de l'ingestion historique (guild.ingestStatus) | ✅ |
| 10 | `memory.forget` | « oublie-moi » → memory.forget + opt-out en DB (cleanup post-test) | ✅ |

**Timeline honnête** : passe complète 15:39 → 9/10 (`skills.casino` en variance modèle : réponse directe sans consultation de la bibliothèque ; prompt rendu explicite « cherche d'abord la recette » comme `skills.voice`) → revalidation ciblée 16:06 → PASS. Les 10 scénarios ont chacun leur verdict PASS dans le journal.

## 2. Rigs spécialisés (mêmes sessions)

| Rig | Scénarios | Résultat |
|---|---|---|
| `e2e-gate.mjs` | webhook intrus, non-adressé, mention, reply-to-bot, autre bot | **5/5 PASS** |
| `e2e-surface.mjs` | surface → trigger armé → **KILL bot pendant le timer** → guardian → rattrapage → bouton VERT ACTIF | **4/4 PASS** |
| `e2e-features4.mjs` | surface.runtool (définition persistée), members.pickRandom, polls.compose, records.counter, audit channel.created/deleted, skills sans fantômes | **6/6 PASS** |
| `tool-evals.mjs` | 8 prompts canoniques (weather, activity-summary, translate, server-status, voice-limit, reminder, jobs-schedule, search-routing) | **8/8 PASS** |

**Cumul session : 33/33 PASS** (10 suite + 5 gate + 4 surface + 6 features4 + 8 evals).

## 3. Fixes produits déclenchés par ces runs

1. **`llm.service` baseUrl sans fallback env** : « Invalid URL: null/chat/completions » quand la config venait de l'env (la clé avait le fallback, pas l'URL). Corrigé aux deux call sites.
2. **`surface.get/patchState/updateComponent` identifient la surface par surfaceId OU messageId** : le modèle fumbliat l'ID interne quand on ne lui donne que le message.
3. **`surface.updateComponent` patche aussi l'en-tête** (title/description) : impossible d'afficher les résultats d'un vote AVANT ce fix.
4. **`IntegrationModule` handlers=0** : les handlers étaient en providers sans la clé `handlers` → bouton « Connecter un fournisseur IA » mort. Corrigé (boot affiche 1 handler).
5. **Rig surface** : exit non-zéro du guardian (impatience healthz) traité comme fatal → tolérant + waitHealthz 180 s.
6. **Anti-bruit gate** validé en live par `gate.noise` (scénario 1).

## 4. Nouveautés livrées dans la foulée (critique produit owner)

- **Panneau de configuration refondu** (retour du 23/11) : une demande de config montre UNIQUEMENT ce qui est appliqué sur CE serveur - règles GuildRule, skills actifs (top + total), intégrations connectées avec leurs **modèles** (jamais les clés), mode thinking. Tools : `config.panel` (fil privé ⚙️┃config-bot), `server.overview` (vue conversationnelle), `config.thinking` (adaptive/always/off). Zéro listing des 135 blueprints ni de la config legacy.
- **Thinking adaptatif par serveur** (défaut `adaptive`) : reasoning_effort envoyé UNIQUEMENT pendant les tours avec tools (pas la conversation simple, pas la synthèse finale), et seulement aux endpoints compatibles (DeepSeek/Anthropic). Réglable via `config.thinking`.
- **Context7 MCP** configuré (`.mcp.json` gitignored, clé au niveau projet) + règle obligatoire dans AGENTS.md : vérification documentaire avant toute modif d'un package de production.

## 5. État final

- `E2E_ENABLED=false` dans `.env.example` (+ `E2E_GUILD_ID` documenté) ; le `.env` local de dev garde `true` pour les rigs.
- Bot en production sur le build final : boot propre, LLM DeepSeek Flash connecté (env), 163 tools, 135 recettes, fil config-bot opérationnel.
- Journal consolidé : chaque run cumule ses verdicts avec `runId` (append-only).
