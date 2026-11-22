# Refactoring Audit - rapport consolidé (22/11/2026)

Double audit exhaustif réalisé par 7 sous-agents en lecture seule.
Audit 1 : 100% de la codebase. Audit 2 : 100% du dossier `Discord Bot Framework examples`.

## Compteur

| Zone | Fichiers | Statut |
|---|---|---|
| assistant / auth / health / queue | 30 / 30 | [x] lu intégralement |
| agent / tool-registry / module-manager / guild-config | 24 / 24 | [x] lu intégralement |
| tickets / polls / records / jobs / utility / security / automations + src/shared | 30 / 30 | [x] lu intégralement |
| serverlife / levels / invites / voice / music / webtools / imagelab / database / audit / logging / memory / moderation / roles / welcome | 41 / 41 | [x] lu intégralement |
| packages/shared + configs (prisma, tsconfig, spraxium.config, docker-compose, package.json) + dashboard + graphe imports | 78 | [x] lu (72 entiers, 6 primitives UI dashboard sans enjeu) |
| **Total Audit 1** | **203 fichiers** | **147 verdicts fichier par fichier, 0 case restante** |

Ecarts documentes : `modules/api` couvert via les contrats (guilds.controller lu entier) ; `scripts/*.mjs` en lecture ciblee ; artefacts `.mimosa/**` committes dans `src` exclus du code (a supprimer).

Verdicts : **95 GARDER / 45 REFACTORER / 2 FUSIONNER / 6 SUPPRIMER** (+ 3 tables Prisma mortes + artefacts).

## Bugs critiques (fixes en Phase 1)

1. `record.write` et `vote` ecrivent des colonnes inexistantes : `panels.service.ts:147` et `polls.service.ts:139` passent `channelId`/`messageId` a `prisma.agentRecord.create`, absents du schema, de la migration et du type genere.
2. 12 listeners d'audit Discord totalement morts : aucune classe de `logging/listeners/audit.listeners.ts` n'a `@Listener(Events.X)` ; le framework les ignore silencieusement ; l'audit d'evenements (18/11) n'enregistre rien.
3. Cache automations bugge par triggerType : `activeFor` met en cache les lignes deja filtrees sous cle `guildId` seul ; les automatisations joined/left ne se declenchent jamais dans les 30 s suivant un autre trigger.
4. `tally.votes` ne retrouve pas les votes : `ctx.messageId` recoit `row.id` (ID panel) alors que le tool recoit l'ID message Discord renvoye par `sendPanel`.
5. Race de bascule driver queue : la sonde Redis 5 s peut commuter vers MemoryDriver apres `setProcessor` ; jobs perdus. `repliesToBot` force toujours false.
6. Watermark boot-recovery avance meme si l'enqueue est refuse : demandes perdues au restart.
7. Elevation de privileges `runTool` : `permissions: ['Administrator']` sans `roleIds` dans panels et jobs ; un node deny est contournable par bouton ou job.
8. Succes mensongers : pin/unpin, webhook.post, reaction.add, temp.sanction, announceStep, imagelab repondent `ok: true` apres un `.catch(() => {})` ; `purgeMessages` compte les messages comme supprimes meme si `bulkDelete` echoue.
9. Jobs `addRole/removeRole` acceptes par le schema mais no-op sans `lastError`.
10. `recordVote` par substring (`data: { contains: messageId }`) sans filtre guildId : vote modifiable sur le mauvais sondage possible.
11. Cle `pending` userId seule dans verification : defi ecrase pour un membre present sur 2 serveurs ; `kickMinutes` hardcode 5.
12. `setTimeout(60s)` de suppression de salon ticket en memoire : restart dans la fenetre = salon orphelin.
13. `announceBirthdays`/`sweepTempSanctions` ne tournent qu'au boot.
14. Skills supprimees resemees au boot (seed filtre `deletedAt: null`).
15. Tools sans permission : `readMessages`, `sendMessage` (`permissions: []`), `createSkill` (regle durable injectee dans chaque prompt).
16. FK AuditLog : `.catch(() => {})` ligne 38 d'audit.service avale la violation pour toute guild sans row `guilds`.
17. Fenetre de grace jobs : un `once` en retard est desactive sans jamais s'executer.
18. Menus panel : tous partagent `'panel:select'` ; 2 menus dans un panel = conflit.
19. Docker : `env_file: .env` inexistant a la racine, port 3000 publie mais serveur lie a `127.0.0.1`, Redis sans `depends_on`/`REDIS_URL`.
20. `f in PermissionFlagsBits` accepte `__proto__`/`toString` ; `setConfigValue` promet CONFIG_KEYS sans le verifier ; `main()` sans catch.

## Detail par fichier

### assistant / auth / health / queue (30/30)

- [x] `src/main.ts` (95) GARDER - import mort IntentPreset, main() sans catch
- [x] `src/app.module.ts` (80) GARDER
- [x] `src/app.env.ts` (102) GARDER - type PORT number vs defaut string
- [x] `spraxium.config.ts` (15) GARDER
- [x] `src/auth/auth.controller.ts` (25) REFACTORER - PrismaService injecte jamais utilise
- [x] `src/auth/auth.instance.ts` (43) REFACTORER - 2e PrismaClient, baseURL hardcodee 127.0.0.1
- [x] `src/auth/env.accessor.ts` (14) GARDER
- [x] `src/auth/guards/guild-access.guard.ts` (58) GARDER - cache statique non purge
- [x] `src/auth/guards/session.guard.ts` (19) GARDER
- [x] `src/modules/health/health.controller.ts` (40) GARDER - /healthz public expose compteurs
- [x] `src/modules/health/health.monitor.ts` (100) GARDER
- [x] `assistant/assistant.module.ts` (30) GARDER
- [x] `assistant/assistant.queue.ts` (121) REFACTORER - race bascule driver, repliesToBot toujours false
- [x] `assistant/assistant.service.ts` (1027) REFACTORER - god object, 17 empty catches, 4 variables mortes ; extraire AgentLoop/SystemPromptBuilder/ServerSnapshotService
- [x] `assistant/boot-recovery.service.ts` (82) REFACTORER - watermark avance meme si enqueue echoue
- [x] `assistant/llm.accessor.ts` (17) GARDER - service locator assume
- [x] `assistant/llm.service.ts` (360) REFACTORER - LLM_PRESETS/clearConfig morts, prisma x3, timeout doublon
- [x] `assistant/response-cache.service.ts` (78) GARDER
- [x] `assistant/tools-nav-buttons.ts` (11) GARDER
- [x] `assistant/tools.panel.ts` (33) FUSIONNER dans v2.containers.ts
- [x] `assistant/v2.containers.ts` (118) GARDER
- [x] `assistant/web-agent.service.ts` (188) REFACTORER - boucle LLM dupliquee avec assistant.service, pas d'audit llm.usage
- [x] `assistant/components/ia-config.components.ts` (35) GARDER
- [x] `assistant/handlers/ia-config.handlers.ts` (104) GARDER - audit.record non attendu
- [x] `assistant/handlers/tools-page.handlers.ts` (54) GARDER
- [x] `assistant/listeners/assistant-mention.listener.ts` (220) REFACTORER - log [GATE] par message, gating multi-concerns ; refonte Gate Phase 1
- [x] `assistant/queue/types.ts` (45) GARDER - JOB_ATTEMPTS mort (doublonne hardcode)
- [x] `assistant/queue/queue-driver.ts` (21) GARDER - bon pattern Strategy
- [x] `assistant/queue/bullmq.driver.ts` (81) REFACTORER - constantes hardcodees, Worker non ferme
- [x] `assistant/queue/memory.driver.ts` (70) GARDER - `this.handler!` fragile

### agent / tool-registry / module-manager / guild-config (24/24)

- [x] `agent/agent.module.ts` (29) GARDER - purger whitelist/imports
- [x] `agent/agent.service.ts` (432) FUSIONNER avec module-manager puis REFACTORER (Strategy par op) ; ~175 lignes dupliquees, 6 branches executeOp mortes
- [x] `agent/whitelist.service.ts` (41) SUPPRIMER - zero consommateur + table AdminWhitelist
- [x] `agent/skill.service.ts` (330) REFACTORER - resurrection skills au boot, N+1 seed, sweep O(n^2)
- [x] `agent/skills.library.ts` (206) REFACTORER donnees - contradictions (serverlife vs birthdays), recouvrements, drift tools
- [x] `agent/panels.service.ts` (698) REFACTORER - 7 responsabilites ; ecran: schema pur/renderer/repository/tools/facade ; executors ticket + record.write rendus a leurs modules
- [x] `agent/panels.handlers.ts` (113) REFACTORER - 5 classes jumelles, 7 casts member
- [x] `agent/tools/discord.tools.ts` (400) REFACTORER - muteMember sans ModCase, purgeMessages non destructive, prompts obsoletes
- [x] `agent/tools/discord.tools.extra.ts` (751) REFACTORER - 656 lignes d'une fonction, readMessages/sendMessage sans permissions, `f in PermissionFlagsBits` prototype
- [x] `tool-registry/tool-registry.service.ts` (325) REFACTORER - 43% hors sujet, audit input non tronque, permissions fournies par l'appelant
- [x] `tool-registry/tool-registry.module.ts` (14) GARDER
- [x] `module-manager/module-manager.service.ts` (212) REFACTORER - branche global morte, pipeline d'acces inerte (decision : supprimer le pipeline, garder toggles)
- [x] `module-manager/module.catalog.ts` (50) REFACTORER donnees - findModuleByCommand mort
- [x] `module-manager/module-state.store.ts` (52) SUPPRIMER - jamais ecrit
- [x] `module-manager/guild-module-state.service.ts` (90) REFACTORER - updateConstraints/invalidate morts
- [x] `module-manager/cooldown.service.ts` (50) SUPPRIMER avec le pipeline
- [x] `module-manager/module-enabled.guard.ts` (41) SUPPRIMER - retourne toujours true
- [x] `module-manager/module-manager.module.ts` (15) GARDER allege
- [x] `module-manager/module-channel.exception.ts` (12) GARDER - consommee par moderation
- [x] `module-manager/module-dependency.exception.ts` (12) SUPPRIMER avec le pipeline
- [x] `module-manager/module-disabled.exception.ts` (11) SUPPRIMER avec le pipeline
- [x] `guild-config/guild-config.service.ts` (90) REFACTORER leger - exportConfig/importConfig morts
- [x] `guild-config/guild-config.module.ts` (13) GARDER
- [x] `guild-config/guild-error.layout.ts` (27) GARDER

### systemes composables (30/30)

- [x] `tickets/tickets.service.ts` (336) REFACTORER - extraire TranscriptRenderer + tools ; claim sans garde ; transcript plafonne 1000 messages non documente
- [x] `tickets/tickets.handlers.ts` (299) REFACTORER - TicketCloseHandler god handler (setTimeout 60 s), garde staff dupliquee x3
- [x] `tickets/tickets.module.ts` (48) GARDER
- [x] `tickets/components/ticket.components.ts` (34) GARDER - dedupliquer labels
- [x] `tickets/listeners/ticket-first-response.listener.ts` (37) REFACTORER - prisma direct + isStaff reimplante
- [x] `polls/polls.service.ts` (200) REFACTORER - bug substring messageId, sweepLegacyPolls mort, rendu hors shared/ui
- [x] `polls/polls.module.ts` (12) GARDER - commentaire mensonger
- [x] `records/collections.ts` (77) GARDER - y declarer component_votes
- [x] `records/records.service.ts` (199) GARDER - JSON.parse sans garde, buildTools x2
- [x] `records/records.module.ts` (10) GARDER
- [x] `jobs/jobs.service.ts` (317) REFACTORER - addRole/removeRole no-op, executor runTool duplique avec panels, JobsEngine + jobs.tools a separer
- [x] `jobs/jobs.module.ts` (11) GARDER
- [x] `utility/utility.service.ts` (357) REFACTORER - 10 tools sans lien, succes mensongers, scinder par domaine
- [x] `utility/utility.module.ts` (11) GARDER
- [x] `security/security.service.ts` (174) REFACTORER - split nodes vs verify, ternaire identique
- [x] `security/verification.service.ts` (116) REFACTORER - cle pending userId-only, kickMinutes hardcode
- [x] `security/verification.handlers.ts` (79) REFACTORER - 3 handlers dupliques
- [x] `security/verification.listener.ts` (55) GARDER
- [x] `security/verification.components.ts` (14) GARDER
- [x] `security/security.module.ts` (18) GARDER
- [x] `automations/automations.service.ts` (310) REFACTORER - bug cache triggerType, split executor/tools
- [x] `automations/automations.listeners.ts` (39) GARDER - fix decorateurs @Listener + channelId detourne
- [x] `automations/automations.module.ts` (15) GARDER
- [x] `shared/actions/registry.ts` (43) GARDER - pattern sain ; y migrer runTool/record.write
- [x] `shared/actions/default-executors.ts` (57) GARDER - propager les echecs
- [x] `shared/tools/status-tool.ts` (31) GARDER - modele a generaliser
- [x] `shared/ui/index.ts` (61) GARDER - import mort FileBuilder
- [x] `shared/utils/locale-detect.ts` (14) GARDER
- [x] `shared/utils/object.ts` (24) GARDER
- [x] `shared/utils/safe-fetch.ts` (45) GARDER

### vie de serveur + infra (41/41)

- [x] `serverlife/serverlife.service.ts` (652) REFACTORER - 8 tools/15 records deguises a migrer vers records ; temp.sanction double systeme ; sanctions en succes mensonger ; anniversaires/sweep boot-only
- [x] `serverlife/serverlife.listeners.ts` (118) GARDER - `void this.serverlife` mort
- [x] `serverlife/serverlife.module.ts` (21) GARDER
- [x] `levels/levels.service.ts` (181) REFACTORER leger - pending/canAnnounce morts, double ecriture Prisma
- [x] `levels/levels.listener.ts` (14) GARDER
- [x] `levels/levels.module.ts` (15) GARDER
- [x] `invites/invites.service.ts` (157) GARDER - durcir le diff (break au premier gagnant)
- [x] `invites/invites.listeners.ts` (14) GARDER
- [x] `invites/invites.module.ts` (13) GARDER
- [x] `voice/voice.service.ts` (347) GARDER - le plus propre du lot
- [x] `voice/voice.module.ts` (12) GARDER
- [x] `music/music.service.ts` (201) REFACTORER leger - client kie.ai a mutualiser, polling bloquant
- [x] `music/music.module.ts` (10) GARDER
- [x] `webtools/webtools.service.ts` (840) REFACTORER - decoupage 6 domaines, 30 fetch sans timeout, SSRF RSS/news, xmlParser mort, annee 2026 codee
- [x] `webtools/webtools.module.ts` (11) GARDER
- [x] `imagelab/imagelab.service.ts` (171) GARDER - resume mensonger si sendFile echoue
- [x] `imagelab/imagelab.module.ts` (13) GARDER
- [x] `database/database.module.ts` (11) GARDER
- [x] `database/prisma.service.ts` (19) GARDER
- [x] `audit/audit.service.ts` (64) REFACTORER - repair FK (upsert Guild + log)
- [x] `audit/audit.module.ts` (12) GARDER
- [x] `logging/logging.service.ts` (63) GARDER
- [x] `logging/logging.module.ts` (50) GARDER - apres fix audit.listeners
- [x] `logging/listeners/audit.listeners.ts` (204) REFACTORER - 12 classes MORTES sans @Listener (fix minimal prioritaire)
- [x] `logging/listeners/ban.listener.ts` (22) GARDER
- [x] `logging/listeners/member-update.listener.ts` (44) GARDER
- [x] `logging/listeners/message.listeners.ts` (52) GARDER
- [x] `logging/listeners/voice.listener.ts` (33) GARDER
- [x] `memory/memory.service.ts` (207) GARDER - bascule consolidation async
- [x] `memory/memory-curator.service.ts` (208) REFACTORER - queue de consolidation + retry (aucun retry aujourd'hui)
- [x] `memory/memory-curator.spec.ts` (111) GARDER
- [x] `memory/memory.module.ts` (16) GARDER
- [x] `moderation/moderation.service.ts` (361) REFACTORER leger - purge compte faux, counter non transactionnel, absorber temp.sanction
- [x] `moderation/moderation.module.ts` (14) GARDER
- [x] `roles/roles.command.ts` (47) GARDER
- [x] `roles/roles.status.ts` (32) GARDER
- [x] `roles/roles.module.ts` (12) GARDER
- [x] `welcome/welcome.state.ts` (6) GARDER
- [x] `welcome/welcome.status.ts` (31) GARDER
- [x] `welcome/welcome.module.ts` (13) GARDER
- [x] `welcome/listeners/guild-member-add.listener.ts` (35) GARDER
- [x] `welcome/listeners/guild-member-remove.listener.ts` (41) GARDER

### packages/shared + configs (1E)

- [x] `shared/src/index.ts` (17) GARDER - reexport AgentPlanSchema mort a purger
- [x] `shared/src/types/module-descriptor.ts` (27) GARDER - a faire importer par le dashboard (copie locale aujourd'hui)
- [x] `shared/src/schemas/module-constraints.ts` (33) GARDER
- [x] `shared/src/schemas/guild-config.ts` (163) REFACTORER - 21 sous-exports orphelins, LOG_CATEGORIES reddeclare cote bot, registre incomplet
- [x] `shared/src/schemas/components.ts` (107) REFACTORER - 8 exports sans importeur, bot valide avec ses propres schemas locaux (source de verite double), action counter sans executor
- [x] `shared/src/schemas/errors.ts` (13) REFACTORER sinon SUPPRIMER - zero importeur
- [x] `shared/src/module-dependencies.ts` (99) GARDER
- [x] `shared/src/template-engine.ts` (25) GARDER
- [x] `shared/src/tools/types.ts` (76) GARDER - passer a BotTool generique pour tuer les 130 casts `input as`
- [x] `shared/src/tools/admin-ops.ts` (87) REFACTORER - AgentPlanSchema/DESTRUCTIVE_OP_TYPES morts, commentaire mensonger (confirmation promise, execution directe)
- [x] `shared/tests/*` (3 fichiers, 157) GARDER - aucune couverture components/admin-ops/errors
- [x] `shared/package.json` + `tsconfig.json` GARDER - include exclut tests du tsc
- [x] `apps/bot/prisma/schema.prisma` (552) REFACTORER - tables mortes Tag/AgentPlan/UserLocale, AgentRecord sans channelId/messageId, TicketFeedback sans FK, tz Europe/Paris en dur
- [x] `apps/bot/spraxium.config.ts` (15) GARDER - hors tsc (piege documente)
- [x] `config/http.config.ts` / `components.config.ts` / `development.config.ts` GARDER - host 127.0.0.1 + CORS DASHBOARD_ORIGIN
- [x] `docker-compose.yml` REFACTORER - env_file .env inexistant, port publie mais 127.0.0.1, Redis sans depends_on/REDIS_URL
- [x] `package.json` (racine + bot + shared) GARDER
- [x] tsconfig x3 GARDER - strict partout, include exclus scripts/config

## Couplages / imports circulaires

- 1 seul cycle source : `agent.service.ts` <-> `tools/discord.tools.ts` (import de valeur pour un usage de type ; `import type` le casse).
- Cycle logique assistant <-> memory : `QuotaExhaustedError` importe par memory-curator + `llm.accessor`. Non bloquant, fragile.
- Duplication fonctionnelle majeure : `TicketsService.open()` vs `panels.createTicketChannel()` (meme table, meme compteur, permissions divergentes).
- kie.ai duplique music/webtools ; runTool-as-admin duplique jobs/panels ; double systeme sanctions serverlife/moderation.
- 8 service-locators coexistent (getToolRegistry, getLlm, getSkillTriggers, getValidatedEnv, getAuth, getConfigServiceForLayout, getModuleManager x2 dont 1 mort).
- Fragilite ordre de boot : `getToolRegistry()` exige le constructeur deja execute ; 8 services l'appellent dans onBoot alors que ToolRegistryModule arrive apres eux dans AppModule.
- Modules les plus importes : tool-registry (21), database (21), shared (14), guild-config (13).
- `check-modules.mjs` : premier controle inoperant (regex `imports:\s*\[` matche toujours).

## Contrats dashboard (a preserver)

- Le dashboard n'importe de shared que `CONFIG_KEYS` + `ConfigKeyDescriptor` ; le reste en types locaux redéclares.
- 12 endpoints REST sous `/api/v1/guilds[...]` + `/api/auth/*` ; enveloppe d'erreur `{ ok: false, error, details? }` ; cookies `credentials: 'include'` ; CORS `DASHBOARD_ORIGIN` (split `,`) ; proxy Vite `/api` vers `127.0.0.1:3000` ; valeur "aucun" = `''` jamais `null` ; routes sans slash final.
- `silent` toujours false cote bot : branche dashboard morte.
- Incoherence : auth.instance passe `DASHBOARD_ORIGIN` entier a `trustedOrigins` sans split.

## Audit 2 : Discord Bot Framework examples (100%)

### spraxium + spraxium-docs (1605 + 270 fichiers)

- Le dispatcher ne route pas des customIds arbitraires depuis une DB : `baseId` compare par egalite exacte au decorateur ; identite de l'enregistrement dans le suffixe (`~k=v` inline, 100 chars max, ou store `~p:` TTL 600 s). Boutons durables = inline + relecture DB (pattern close-ticket-button de dynamic-bot).
- ContextStore = singleton statique + adaptateurs memory (defaut silencieux) / file / sqlite / redis ; `ContextStorageAdapter` = 4 methodes (get/set/delete/entries) : point de branchement pour le moteur d'etats.
- Guards sur composants : un `return false` ne repond RIEN (contraire a la doc) ; exceptions des handlers de composants hors layouts (utiliser onErrorReply).
- Aucun exemple voice dans le framework ; GuildVoiceStates absent du preset Standard.
- Doc en retard : format customIds, buildDynamic, ordre des args i18n, buildLocalizedV2.
- Limites : cache chaud jamais invalide multi-processus, module partage entre 2 modules non racine non garanti, guards sans DI, CooldownGuard non persiste.
- Fichiers de reference : `packages/components/src/runtime/dispatcher/components/button.dispatcher.ts`, `split-custom-id.helper.ts`, `context.store.ts`, `context-storage.interface.ts`, `apps/dynamic-bot/modules/tickets/` (bouton DB durable), `packages/core/src/guards/guard.executor.ts`, `packages/core/src/bootstrap/module.loader.ts`.

### reference-bots + divers

| Source | A adopter | Vigilance |
|---|---|---|
| Discord-AI-Bot (Bluzzi) | boucle stopWhen/prepareStep, toolsContext (IDs lies cote serveur), skills en 2 niveaux (index court -> ouverture : notre tool routing), garde-fous injection, model_usage par cause | discord.ts 1806 l. ; memoire devenue per-user (AGENTS.md a reconcilier) |
| discord-manager-pro | contrat tool + pipeline unique executeTool (mode -> rate-limit destructeurs par guilde -> Zod -> perms bot -> handler -> audit), LIMITS, requestId | listes de noms DESTRUCTIVE_TOOLS en derive ; Zod 4 _def.shape() |
| wardhive | emits/listens dans le catalogue + HookBus, replyV2 + verrou anti double-clic 16 s, union typede de jobs, enveloppe {data, meta} | plugins 979/1101 l. ; GPL-3.0 (ne pas copier) |
| skyra | planificateur persistant + carte typede TaskData (Ignore/Delay/Update/Finished), ChannelConfigurationCommand (fabriques de tools) | - |
| discord-tickets | customId = payload JSON sans etat serveur | etat $stale en memoire |
| CorwinDev / saiteja | inventaire features + anti-patterns ; pipeline validations->perms->cooldown | - |
| tailadmin-react-pro | pages ai-assistant/integrations/api-keys pour le dashboard | licence Pro a verifier |
| awesome-software-architecture / reference-apis | cadre (vertical slice, outbox, hexagonal) ; 2480 APIs publiques comme source de tools | oriente .NET |

## Decisions arbitrees (22/11/2026)

1. Pipeline module-manager : SUPPRIME (toggles guild conserves pour le dashboard).
2. Sanctions : temp.sanction FUSIONNE dans moderation (ModCase unique + job de revocation).
3. Sequence : bugfixes -> refactor POO -> moteur InteractiveSurface -> PostgreSQL 16 + TimescaleDB (Phase 4 explicite).
4. record.write/vote : hotfix immediat (Phase 1).
5. Volet comportement/perf/UX du Plan v3 reintegre : gate refondue, reponses adressees messageReference, streaming SSE + throttle 1,8 s, tool routing noyau + search_tools, activity.summary SQL, prompt XML dans SystemPromptBuilder.
