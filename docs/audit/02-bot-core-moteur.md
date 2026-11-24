# Audit 02 · Bot core & moteur

> Mesures du 23/11/2026 en fin de journée.

## 1. Bootstrap (`main.ts`)

`SpraxiumFactory` unique : validation env (`AppEnv` Zod) → create → `useModule(AppModule)` → `provide(AppEnv)` → `listen()` → **purge du registre de slash commands Discord** (le produit est 100 % conversationnel : aucun `/xxx` ne doit survivre).

`app.module.ts` : 24 modules importés (tickets/roles/levels/invites/welcome retirés en C1). `@HttpClientModule` sur LA MÊME classe (règle framework : un second module HTTP serait ignoré).

**Règle de cycle de vie (apprise le 23/11)** : le framework n'instancie jamais les classes de module. Il n'enregistre que les `providers`, `listeners` et `handlers` (`ModuleLoader.loadModule`, puis `registerLifecycle`). Un `onBoot`, un `onReady` ou un `constructor` écrit dans une classe `@Module` ne s'exécute JAMAIS. Toute liaison runtime se fait donc dans le `onBoot` d'un provider, et `pnpm arch:audit` refuse désormais ce motif (règle `LIFECYCLE_ON_MODULE`).

## 2. Assistant (le cœur)

| Composant | Fichier | Points clés |
|---|---|---|
| Gate | `listeners/assistant-mention.listener.ts` | Chaîne courte zéro-LLM ; try/catch global ; anti-bruit social ; zone-libre false par défaut |
| Queue | `assistant.queue.ts` + `queue/` | Driver BullMQ (Redis) / memory fallback (sonde 5 s, bascule à chaud) ; FIFO par user, 3 parallèles |
| Boucle | `agent-loop.service.ts` | Template Method partagé Discord/web ; 12 itérations max ; synthèse finale sans tools si boucle épuisée ; résultats de tools sérialisés avec `stringifySafe` (tolérant aux BigInt) |
| Prompt | `system-prompt.builder.ts` | XML par sections (`<SERVER_RULES>`, `<SKILLS>`) ; préfixe statique pour le cache provider DeepSeek |
| Streaming | `llm.service.ts` + `llm-endpoint.ts` + `llm-transport.ts` | orchestrateur du moteur multi-fournisseurs (§6b) : route du serveur ou instance, SSE + watchdog d'inactivité, erreurs typées, bascule sur le fournisseur de repli |
| Statut | `live-status.ts` + `investigation.policy.ts` | une seule ligne, éditée en place ; les lectures de recherche se taisent (`[SOURCES]` une fois) |
| Rendu | `progressive-responder.ts` | Édition unique throttlée 1,8 s ; médias = UNE pièce jointe réelle |
| Reprise | `boot-recovery.service.ts` | Watermark par salon dédié + relance des jobs persistés |

**Thinking stable** (`LlmService.planRequest`, réglage par serveur, défaut `adaptive`) : décidé UNE fois par requête, avant le premier tour, et gardé identique sur tous ses tours. `preferReasoning` vient du réglage et de l'intention de la demande (orientée action ou non) ; il choisit la route `chat.reasoning` quand le serveur en a une. L'effort envoyé se décide contre le fournisseur qui exécutera la requête, et part seulement vers les endpoints qui l'acceptent (DeepSeek, Anthropic). Le basculer en cours de boucle a coïné avec la fuite de balises internes de l'incident de 20:09.

**Investigation silencieuse** (`investigation.policy.ts`, transposé de discord-agent) : une lecture de recherche (recherche web, actualités, flux, page, dépôt) n'est pas racontée appel par appel. La ligne de statut affiche `[SOURCES] Je consulte mes sources...` à la première, puis ne bouge plus. Les actions et les lectures du serveur gardent leur ligne `[TOOL]`, de même que `search_tools` et `search_skills`.

## 3. Registry et exécution d'un tool (`tool-registry.service.ts`)

Ordre réel des portes dans `ToolRegistryService.run` : modules requis actifs → node `deny` → permissions Discord (sauf node `allow`) → validation Zod → **confirmation destructive** → handler → audit.

La confirmation destructive (règle serveur `confirmDestructiveActions`) dépend de quatre liaisons runtime : `rules` (liées par `GuildRulesService.onBoot`), `cache`, `prisma` et `renderSurface` (liées par `ToolRegistryService.onBoot`, le rendu par `SurfaceService.onBoot`). Le démarrage le vérifie et affiche « confirmation destructive opérationnelle » ou un avertissement explicite. Comportement couvert par `tool-registry.confirm.spec.ts` (7 tests).

## 4. Moteur de surfaces (`modules/surface/`)

- `surface.service.ts` : CRUD surfaces + re-rendu ; 6 tools (`surface.create/patchState/updateComponent/get` + triggers). Les tools d'édition identifient une surface par `surfaceId` OU `messageId`.
- `surface.errors.ts` : messages d'erreur actionnables (chemin du champ Zod fautif, liste des clés de binding valides, rappel de l'identifiant fourni).
- `surface.handlers.ts` : le trio générique, `SurfaceActHandler` (boutons), `SurfaceSelectHandler`, `SurfaceModalHandler`. **Ce sont les seuls handlers d'interaction métier du bot.**
- `surface.pipeline.ts` : exécuteur de pipeline typé (14 kinds de steps) ; `claimOnce` = SET NX (course concurrentielle sûre).
- Triggers : `ScheduledTrigger` BullMQ + rattrapage au boot (testé par le rig `e2e-surface` avec reboot en cours de timer) ; `EventTrigger` route 10 événements Discord.

Anti-régressions notables : surfaces coquille-vide refusées (titre et labels réels exigés) ; placeholders probe/ping refusés ; null-guard sur `message.author` dans `captureSnipe`.

## 5. Règles serveur (`modules/rules/`)

`GuildRulesService` : store DB + cache 60 s ; consommé par la Gate (zones, salons muets), le registry (confirmation destructive) et le SystemPrompt (`<SERVER_RULES>`). Tools `rules.set` (ManageGuild) et `rules.list`. Son `onBoot` lie le service au registry et à l'accesseur `getGuildRules`.

## 6. Intégrations chiffrées (`modules/integrations/`)

`IntegrationService` (catalogue llm/pixellab/kie) + `secret-box.ts` AES-256-GCM (clé dérivée `ENCRYPTION_SECRET ?? BETTER_AUTH_SECRET ?? token`).

Flux UI : `IntegrationStatusPresenter` (panneau V2 pur) → bouton `integration:llm:open` (`@Button`) → `IntegrationOpenModalButtonHandler` (`@ButtonHandler`, garde `GuildAdminPolicy`) → modale `integration-config` (`@ModalComponent`, 3 champs) → `IntegrationSaveModalHandler` (`@ModalHandler`) → `LlmService.applyConfig` : contrôle `GET /models`, rechargement immédiat du runtime, persistance chiffrée.

`IntegrationService.upsert` seul ne suffit pas : il persiste et vide son cache, mais `LlmService` garde sa configuration en mémoire depuis le boot. C'est `applyConfig` qui fait les deux.

Couverture : `integration.handlers.spec.ts` (9 tests : métadonnées de routage, garde Policy, appel à `applyConfig`, jamais la clé dans la réponse). Le clic réel reste à confirmer à la main : un rig REST ne peut pas produire d'interaction de composant.

## 6b. Moteur multi-fournisseurs (`modules/providers/`, nuit du 23 au 24/11)

L'intégration d'instance (section 6) devient l'amorce. Chaque serveur connecte ses propres fournisseurs et associe chaque capacité à l'un de leurs modèles.

- **Tables** : `GuildProvider` (slug unique par serveur, protocole, URL de base, type d'authentification, clé chiffrée AES-256-GCM, en-têtes et options, catalogue en cache) et `CapabilityRoute` (une par capacité et par serveur : modèle, fournisseur et modèle de repli, paramètres). Migration `20261123231500_guild_providers`, appliquée à la main.
- **Contrat** (`shared/llm/chat-contract.ts`) : partagé par le client LLM et les adaptateurs. Le résultat porte `served` (capacité, fournisseur, modèle, repli) : c'est ce que journalise `llm.jsonl`.
- **Adaptateurs** (sans état, un par protocole, inscrits au registre par `ProvidersBoot`) : `OpenAiCompatibleAdapter` (chat, images, voix), `AnthropicMessagesAdapter` (Messages, avec traduction des tools), `KieUnifiedAdapter` (chat, tâches asynchrones image et musique), `GenericHttpAdapter` (opérations REST décrites en gabarits `{{param}}`). Un adaptateur ne laisse jamais ressortir la clé.
- **Routeur** (`CapabilityRouterService`) : route active, tentatives ordonnées, exécution avec bascule, clé d'une capacité hors conversation. `attemptsOf` expose la même liste au client LLM, qui doit reprendre la main avant tout texte publié.
- **Client LLM** : `LlmService` orchestre. `planRequest` décide une fois par requête si elle raisonne (`preferReasoning`) et son effort ; `ChatEndpointPlanner` choisit l'endpoint (route du serveur, sinon instance) ; `ChatTransport` sert les protocoles à SSE et passe les autres à leur adaptateur. Le modèle d'une requête ne change pas en cours de boucle.
- **Migration additive** (`ProviderLegacyMigration`) : au premier appel résolu d'un serveur, l'instance est copiée dans ses fournisseurs et routes (une fois, trace `provider.legacy_migrated`). Les copies portent `_source` et suivent l'instance (`reconcileInstance`, au démarrage de `LlmService` et à chaque `applyConfig`).
- **Routes de conversation liées** (`provider-route.links.ts`) : `chat.reasoning` et `chat.ingestion` suivent `chat.default` tant qu'elles partagent sa cible exacte.
- **Panneau** « Fournisseurs et modèles » : `ProviderHubPresenter` (pur), 10 handlers décorés (3 menus, 6 boutons, 1 modale), garde `GuildAdminPolicy`, état porté par les customIds, catalogue paginé par 25.
- **Tools** : `provider.list/upsert/delete/test/models`, `capability.bind/list`, `providers.panel`. Les tools de lecture sont inscrits dans `READ_ONLY_NAME_RE`.
- **Consommateurs** : la musique, l'image kie.ai et PixelLab lisent clé, URL et modèle de la route du serveur (`credentialsFor`) ; une image routée vers un autre fournisseur passe par l'adaptateur (`runCapability`).

Couverture : 26 fichiers de spec sous `modules/providers` et les specs du client LLM (`llm.service`, `llm-transport`, `llm-endpoint`, `llm-thinking.planner`, `llm.errors`, `request-intent`). Preuve live : `06_E2E_LIVE_REPORT.md` §11.

## 6c. Plans d'action (`modules/action-plan/`, transposé de discord-agent, nuit du 23 au 24/11)

L'étude du dépôt `discord-agent` se lit dans `07_BENCHMARK_DISCORD_AGENT.md`. Quatre mécanismes en ont été tirés.

- **Un plan par demande.** Règle `confirmDestructiveActions` active : un tool `destructive` ne s'exécute pas. La porte du registry (`tool-registry.confirm.ts`) le met en attente (`ActionPlanService.stage`, en mémoire, par serveur, demandeur et salon, 10 actions au plus) ; `AssistantService`, en fin de demande, en fait UN plan (`flush`) : une ligne `InteractiveSurface` de `kind` `action-plan`, un panneau Components V2 posté une fois, l'audit `plan.posted`.
- **Le clic exécute.** Boutons `plan:apply~p=<id>` et `plan:cancel~p=<id>` (`action-plan.handlers.ts`, décorés). `apply` prend le plan une seule fois (`ActionPlanStore.lock` : le statut est le `kind` de la ligne, un second clic le trouve pris), vérifie l'auteur, l'expiration (15 minutes), que le message d'approbation n'a pas été modifié, recharge le membre, archive un instantané du serveur si une action est structurelle, puis exécute les actions dans l'ordre par `registry.run(tool, input, ctx, { approvedBy })`. Un refus ou un échec arrête le plan, avec le compte de ce qui a été fait.
- **Revalidation déterministe** (`core/security/action-plan.policy.ts`) : permissions de l'outil dans le serveur et dans le salon visé, hiérarchie de la cible membre et du rôle, identifiants bien formés, compte suspendu. Elle s'appuie sur `MemberPermissionPolicy.hasIn`, `canActOn`, `canManageRole` et `grantsOnly`.
- **Porte fermée par défaut.** Règles du serveur illisibles : l'action reste bloquée. Auparavant la porte s'ouvrait.

Le panneau est dessiné par `ActionPlanPresenter` (pur) : en attente, demandeur, expiration, actions numérotées, deux boutons ; terminé, le résultat et plus aucun bouton.

Couverture : `tool-registry.confirm.spec` (8 tests), `hierarchy-policy.spec` (50 tests de sécurité), et les specs du module (`action-plan.*.spec`). Le clic réel n'est pas simulable : le scénario live `rule.confirm` vérifie le blocage, le plan et le panneau, pas l'exécution.

## 7. Configuration par serveur (`modules/guild-config/`)

`AgentSettingsService` (thinking, fil de config) et `ConfigThreadService` (fil privé `config-bot`, tools `config.panel`, `server.overview`, `config.thinking`). Le panneau montre uniquement ce qui est appliqué : règles, skills, intégrations, fournisseurs du serveur et modèle de chaque capacité, mode thinking. Jamais les clés, jamais la liste des blueprints ni la configuration legacy. Le fil sert aussi de support au panneau « Fournisseurs et modèles » (`postToThread`).

## 8. Mémoire, curator et ingestion (`modules/memory/`)

Fiches consolidées ≤2 000 caractères avec gardes en code : budget, anti-wipe (réduction de plus de 50 % refusée au-delà de 200 caractères), sujet référencé, zone de données anti-injection. Opt-out total (« oublie-moi ») : purge et blocage futur.

Ingestion de l'historique au premier join : curseur par salon, reprise après crash, plafonds (40 salons, 600 messages par salon, 20 appels LLM).
