# Audit 00 — Architecture & flux

> Audit du 23/11/2026 après Phase A (POO), B (ingestion), C (purge + 135 skills), D (docs). Toutes les métriques sont mesurées sur le code au commit correspondant.

## 1. Vue d'ensemble

| Métrique | Valeur |
|---|---|
| Fichiers TS (apps/bot/src) | 129 |
| Lignes (apps/bot/src) | 18 157 |
| Fichiers TS (packages/shared/src) | 13 (1 184 lignes) |
| Modules Spraxium (`src/modules/`) | 25 |
| Handlers d'interaction restants | 3 (trio surface + integration-config) |
| Listeners d'événements | 10 fichiers `@Listener(Events...)` |
| Tools du registry | 160 |
| SkillBlueprint | 135 (10 domaines) |
| Modèles Prisma | 32 |
| Migrations | 29 |
| Violations arch-audit | 60 (down depuis 81) |

## 2. Flux conversationnel (chaîne complète)

```
Message Discord
→ AssistantMentionListener.onMessageCreate
   [try/catch GLOBAL : log FileLog error+stack, jamais de fuite vers
    le handler anglais Spraxium]
   1. Source : webhooks rigs auto-reconnus (E2E) ; autres bots/webhooks ignorés
   2. Mention d'un autre bot → silence
   3. blockedChannelIds (GuildRule) → MUET TOTAL, même mentionné
   4. Salon dédié / zone libre (freeCategoryIds/freeChannelIds)
   5. Interpellation : dédié = tout ; sinon mention/reply toujours ;
      nom texte UNIQUEMENT en zone libre (strictMentionElsewhere défaut true)
   6. ANTI-BRUIT : sans mention/nom/reply, rires et <3 mots sans
      question → ignoré ([GATE] bruit-social-zone-libre), zéro LLM
→ AssistantQueue (FIFO par utilisateur, 3 parallèles, BullMQ/memory)
→ AgentLoop (12 itérations max + synthèse finale garantie)
→ LlmService.chat (streaming SSE, watchdog inactivité, reasoning_effort
   omis si non configuré — compat OpenRouter/Groq/Gemini)
→ DiscordProgressiveResponder (throttle 1,8s, chaîne d'éditions unique)
→ FileLog JSONL + audit DB + comptabilité llm.jsonl
```

**Garanties vérifiées** :
- Zone-libre `false` par défaut sans règle enregistrée (`DEFAULT_RULES.freeCategoryIds = []` dans `guild-rules.service.ts:29`).
- Un crash de listener ne produit PLUS jamais le message anglais du framework (plafond try/catch + le zombie 12:22 a été tué ; stack confirmée dans `logs/bot-2026-11-23.jsonl` 14:46:11).

## 3. Couche POO (Phase A)

| Stéréotype | Emplacement | Rôle |
|---|---|---|
| Policy | `src/core/security/access-policy.ts` | `BaseAccessPolicy<TCtx>` abstraite + `GuildAdminPolicy` (owner OU Administrator). Seul endroit autorisé pour `PermissionFlagsBits`/`guild.ownerId` |
| Presenter | `modules/*/presenters/` | Données → payload Components V2 pur (ex. `IntegrationStatusPresenter`) |
| Handler | `modules/*/handlers/` | Garde Policy → erreur éphémère → délégation service |

`pnpm arch:audit` enforce 5 règles : UI_IN_SERVICE, PERMISSION_DISPERSED, GOD_CLASS (>300 l.), ANY_TYPE, PROCESS_ENV. 60 violations restantes = dette historique concentrée dans `agent.service.ts`, `assistant.service.ts`, `llm.service.ts` (voir 05).

## 4. Moteur générique (le pivot produit)

- `InteractiveSurface` (définition + état JSON persistés, re-rendu à chaque mutation, survit aux restarts)
- `InteractionBinding` : access policy + pipeline typé (runTool/setState/updateComponent/sendMessage/replyEphemeral/openModal/record.write/trigger.schedule/trigger.cancelByKey/random/llm/if/forEach/claimOnce)
- `ScheduledTrigger` : BullMQ + **rattrapage garanti** après reboot (fenêtre de grâce)
- `EventTrigger` : 10 événements Discord (message.create/delete, member.join/remove/update, voice.join/leave, reaction.add/remove, presence)
- Garde anti-coquille-vide (R0.3) : titre <3 caractères ou labels probe/test/ping → refus actionnable

**Conséquence de la purge C1** : tickets/captcha/panels/roles/welcome/levels/invites n'existent plus comme code ; ils sont des recettes (blueprints) composées de primitives. Au boot Spraxium, seuls `surface:act` / `surface:select` / `surface:modal` + `integration-config` sont enregistrés.

## 5. Ingestion historique (Phase B)

`GuildHistoryIngestionService` : GuildCreate (join frais uniquement, replay de login ignoré) → tâche de fond → pagination 100/page avec backoff 429 → filtres privacy (bots/webhooks/opt-out, snippets 300 car.) → lots de 200 → distillation LLM (`cause: 'memory.ingestion'`) → `GuildMemoryProfile` (budget 2 000 car.) + journal `GuildMemory`. Curseur `IngestionCursor` par salon = reprise après crash ; plafonds : 40 salons, 600 messages/salon, 20 appels LLM. Tools `guild.ingestHistory` (ManageGuild) + `guild.ingestStatus`.

## 6. Points d'attention

1. `llm.service.ts` (523 l.), `assistant.service.ts` (~600 l.), `agent.service.ts` : God Classes restantes à scinder (tracked 05).
2. `GuildHistoryIngestionService.trigger()` garde `getLlm().configured` : l'ingestion est inactive tant qu'aucun fournisseur n'est connecté (état actuel du déploiement dev).
3. La compat du champ `reasoning_effort` est réglée par omission (envoyé seulement si `LLM_EFFORT` non vide) ; `thinking` n'est jamais envoyé (n'existe pas dans nos appels).
