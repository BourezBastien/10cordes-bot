# Audit 05 — Vérification & anomalies

## 1. État de vérification (23/11/2026)

| Vérification | Résultat |
|---|---|
| `pnpm typecheck` | ✅ 0 erreur |
| `pnpm lint` | ✅ 0 erreur |
| `pnpm test` | ✅ 20/20 (7 curator + 13 shared) |
| `pnpm build` | ✅ bundle complet |
| `pnpm check:modules` | ✅ 25 dossiers cohérents |
| `pnpm arch:audit` | ⚠️ 60 violations (dette historique, détails §3) |
| grep docs (.md) | ✅ 0 ancienne var env, 0 ref slash command |
| Processus bot | ✅ 0 (zombie 12:22 tué, port 3000 libre) |

## 2. Anomalie du jour : spam « An unexpected error occurred »

**Symptôme** (14:46-14:47, serveur 1550835980116824136) : à chaque message, erreur anglaise brute du framework.

**Cause racine** (stack `logs/bot-2026-11-23.jsonl` 14:46:11) : une instance zombie du bot (build 12:22:28, pré-purge) tournait encore ; son `TicketFirstResponseListener.onMessageCreate` appelait `prisma.ticket.findFirst()` sur la table `main.tickets` que la migration C1 venait de supprimer.

**Correctifs** :
1. Processus tués (PowerShell CIM filter node.exe + spraxium|10cordes), 0 restant, port 3000 vérifié libre.
2. Le nouveau build ne contient plus le listener (module tickets purgé).
3. Ceinture+bretelles : try/catch global dans `AssistantMentionListener` (log FileLog `listener_exception` avec stack ; plus aucune fuite vers le handler anglais).
4. Anti-bruit Gate : les messages ambiants de pur bruit social (rires, <3 mots sans question) ne déclenchent plus de LLM même en salon dédié/zone libre.

**Leçon** : toute suppression de table doit s'accompagner de l'arrêt des process consommateurs AVANT la migration. Le guardian (`guardian.mjs`) doit être l'unique lanceur.

## 3. Dette arch-audit (60 violations)

| Règle | Count | Concentration |
|---|---|---|
| PERMISSION_DISPERSED | 46 | `agent.service.ts`, `surface.pipeline.ts`, mods discord historiques (self-checks du bot) |
| GOD_CLASS | 13 | `agent.service.ts`, `assistant.service.ts`, `llm.service.ts` (523), `webtools.service.ts`, etc. |
| UI_IN_SERVICE | 4 | assistant/logging/surface (messages système simples) |
| PROCESS_ENV | 1 | `auth.instance.ts` (clientId OAuth) |
| ANY_TYPE | 1 | `assistant.service.ts:41` |

Plan : découper `agent.service.ts` par familles, extraire les Presenters des 4 services UI, router les self-checks par une `BotSelfPolicy` dans core/security.

## 4. Blockers connus

1. **LLM non configuré** : aucune clé en `.env`/`.env.local` ni en DB (`IntegrationConfig` vide). Conséquences : agent répond avec le panneau « Connecter un fournisseur » ; ingestion historique inactive (garde `configured`) ; scénarios E2E agent non exécutables. **Action** : owner/admin clique le bouton (modale) OU `LLM_API_*` en env.
2. **Dérive checksums Prisma** (2 migrations historiques éditées) : `migrate dev` voudra un reset sur la DB dev. Méthode main+execute+resolve à maintenir.

## 5. Risques résiduels acceptés

- 25 modules dont 23 non togglables (catalogue minimal) : assumé, l'agent EST le produit.
- `search_tools` expose tout le registry à la demande : les permissions restent vérifiées par tool (pas d'élargissement de droits).
- Ingestion : coût LLM plafonné (20 appels/guild) ; reprise crash garantie ; privacy (opt-out, bots, snippets) vérifiée en code.
