# AGENTS.md

## Project

**10cordes-bot** - agentic all-in-one Discord bot, **zero commands, 100% conversation-driven** (mention, bot name, or dedicated AI channel). Built on the **Spraxium** framework (`@spraxium/*` v0.9.x, wraps discord.js v14). pnpm monorepo, ESM, Node 22/24/26, Prisma 6 + SQLite, Zod everywhere, **Components V2 as the default rendering** (no "v2" suffixes in names - it is the base UI, helpers live in `apps/bot/src/shared/ui`).

## Monorepo

```
apps/bot          Spraxium bot (+ REST API & better-auth)
apps/dashboard    Web dashboard (React 19 + Vite 8 + Tailwind 4)
packages/shared   @10cordes/shared - Zod schemas, BotTool<T>, SkillBlueprint types
docs/             ROADMAP.md (backlog) · ARCHITECTURE.md (deep dive) · audit/
```

Dependency rule: `apps/bot → @10cordes/shared ← apps/dashboard`. Nothing hardcoded: config = Zod schemas in shared; strings flagged for i18n; durations via `parseDurationMs`.

## Framework resources (read before adding features)

- **Installed framework (what actually runs):** `apps/bot/node_modules/@spraxium/core/dist/index.js` (readable compiled source) and `apps/bot/node_modules/@spraxium/components/dist/index.d.ts` (API signatures). `ModuleLoader.loadModule` in core is the reference for what the framework does with a module. It is the only framework source present on the machine.
- **Context7 comes first** for signatures, options and official good practices: `resolve-library-id` (`/spraxium/spraxium` for the framework, `/discordjs/guide` for discord.js and Components V2), then `query-docs`. Fall back to the installed package above only when Context7 is unavailable in the session.
- No local checkout of the framework sources or docs exists: never refer to one. Reference bots are public GitHub projects used as inspiration only (skyra for settings/i18n, discord-tickets for Prisma/i18n/tickets, Discord-AI-Bot for per-channel AI memory and typed tools, wardhive for typed action queues, RBAC guards and audit).

## Obligatory doc check: Context7 (before touching production packages)

**Règle permanente** : avant TOUTE création, modification, refactoring ou correction impliquant un package de production (`discord.js` v14.x, `@spraxium/*` v0.9.x, `@prisma/client` v6.x, `bullmq`, `ioredis`, `zod`, `better-auth`, etc.), interroger **Context7 MCP** (`resolve-library-id` puis `query-docs`) pour vérifier signatures d'API, options et bonnes pratiques officielles AVANT d'écrire la moindre ligne de code. Si Context7 est indisponible dans la session, le dire explicitement et retomber sur le framework installé (ci-dessus), jamais sur sa mémoire.

Configuration : `.mcp.json` projet (gitignored, ne jamais le committer ni écrire une clé API dans un fichier tracké). Le serveur se charge à l'ouverture de la session.

## Commands (run at repo root unless noted)

```bash
pnpm dev            # builds @10cordes/shared then spraxium dev (in apps/bot)
pnpm build          # build all workspaces (shared → dist, then spraxium build → .spraxium/dist)
pnpm typecheck      # tsc --noEmit in every workspace (bot typecheck builds shared first)
pnpm test           # vitest (unit specs in apps/bot/src/**/*.spec.ts and packages/shared)
pnpm lint           # two passes: conventions (@bluzzi/eslint-config, eslint.config.mjs), then TypeScript bugs only (eslint.ts.config.mjs)
pnpm verify         # lint + typecheck + test + build + check:modules + check:tools + arch:audit (all strict)
pnpm arch:audit     # strict POO report on apps/bot/src and packages/shared/src: exits 1 on ANY violation
pnpm check:tools    # registry-names.ts must match the name literals of tracked sources (run sync-tool-names.mjs after adding a tool)
node apps/bot/scripts/diagnose.mjs [days]            # JSONL log forensics
```

DB migrations: Prisma 6 is pinned; on the dev DB they are applied by hand, never with a reset (see "Data and LLM").

`pnpm arch:audit` has no baseline and no ratchet: zero violation, enforced locally by `pnpm verify` and on every push by CI. Never weaken a rule or add an exception to pass it: fix the code.

## Architecture

- `apps/bot/src/main.ts` - only file touching `SpraxiumFactory`: validate env → create → `useModule(AppModule)` → `provide(AppEnv)` → `listen()` → purge Discord slash-command registry at boot.
- `apps/bot/src/app.module.ts` - root module; every feature module must be in `imports`. Infra modules (memory, records, rules, integrations, guild-config, providers, action-plan, assistant) are `@Global`.
- `apps/bot/src/app.env.ts` - `@EnvSchema()` extending `SpraxiumBaseEnv`. Generic `LLM_API_URL/KEY/MODEL/EFFORT` (no vendor prefixes); `DISCORD_TOKEN` is the only required var.

### Conversation pipeline (the product)

Message → gate (ignore bots/webhooks unless the test allowlist; `GuildRule.blockedChannelIds` = total silence; free zones vs strict mention elsewhere; social noise ignored without an LLM call) → queue (FIFO per user, 3 parallel) → `AgentLoop` (max 12 iterations + synthesis fallback) → `ToolRegistryService.run` → `DiscordProgressiveResponder` (1.8s throttle, single edit chain) → audit + FileLog JSONL.

`ToolRegistryService.run` gates, in order: required modules active → RBAC node `deny` → Discord permissions (unless node `allow`) → Zod validation → **destructive-action plan when the guild rule is on** → handler → audit. A failed tool becomes an explicit `{ ok: false, summary }` that the model relays; it never throws into the loop.

Tool routing (Anthropic pattern): a core set is always visible (`TOOL_CORE_NAMES` in `tool-selection.ts`: reads, `search_tools`, `search_skills` and the surface and trigger primitives, 20 tools), up to 24 relevant tools hors noyau (`selectRelevantTools`), and `search_tools` expands it on demand. Relevance is scored by `packages/shared/src/tools/tool-search.ts` (name, `keywords`, description, category): give a tool `keywords` in plain words when its name and description do not carry them. The primitives are pinned because a primitive left behind `search_tools` was searched 8 times in a row and never called; the `systemPrompt` of pinned tools is injected in `<TOOLSET>` from turn 1, and `search_tools` only announces tools the caller can run (active modules and permissions).

### Action plans (`modules/action-plan/`, transposed from discord-agent)

When the guild rule `confirmDestructiveActions` is on, the model cannot execute a `destructive` tool. The gate (`tool-registry.confirm.ts`) puts the action in wait, `AssistantService` turns everything waiting for a requester into ONE plan when the request ends, and the click executes.

- `ActionPlanService`: `stage` (in memory, per guild, requester and channel, 10 actions max) → `flush` (one plan, one panel, audit `plan.posted`) → `apply` / `cancel` (click).
- The panel is posted once and never edited while pending. A modified approval message cancels the plan (same rule as discord-agent).
- `apply` takes the plan once (`ActionPlanStore.lock`: the status is the row `kind`, so a second click finds it taken), then for each action, in order: `ActionPlanPolicy.review` on the member reloaded with `force: true`, then `registry.run(tool, input, ctx, { approvedBy })`. A refusal or a failure stops the plan with an honest count. A server snapshot is archived before the whole plan.
- `approvedBy` is passed by the server only. The model cannot produce it, and it never re-runs an approved action itself.
- The gate is closed by default: unreadable guild rules block the action (it used to open the gate).
- Policies live in `src/core/security/`: `ActionPlanPolicy` (tool permissions in the guild and in the target channel, member and role hierarchy, snowflake ids), `MemberPermissionPolicy.hasIn / canActOn / canManageRole / grantsOnly`, `ChannelVisibilityPolicy` (`getChannels` returns only what the requester can see).

### POO layer (audited by `arch-audit`, strict)

- **Policy** (`src/core/security/`): the ONLY place Discord permissions, role membership and role hierarchy are read or compared. `GuildAdminPolicy` and `GuildManagerPolicy` (`access-policy.ts`, on a `GuildAccessContext`), `MemberPermissionPolicy` (a `GuildMember`: guild and channel permissions, hierarchy of member and role targets), `PermissionNamesPolicy` (a list of permission names, i.e. `ToolRunContext.permissions` in jobs, triggers and the web channel), `BotPermissionPolicy` (the bot itself), `ChannelVisibilityPolicy`, `ActionPlanPolicy`, `AdminOpPolicy`, `CollectionQuotaPolicy`. Elsewhere, build a context with `guildAccessContext`, `accessContextFromNames` or `interactionAccessContext`, and list names with `permissionsOf(member)`. The audit rejects any other read: `PermissionFlagsBits.`, `.permissions.toArray()`, `.permissions.has(`, `memberPermissions`, `.permissions.includes(`, `guild.ownerId ===`, `member.roles.cache.has(...)`.
- **Presenter** (`modules/*/presenters/`): pure classes, data in → complete Discord payload out (flag `IsComponentsV2` included). No API calls, no side effects.
- **Handler** (`modules/*/handlers/`): policy guard → error message → service delegation. Handlers MUST carry the `@spraxium/components` decorators.
- **No file over 300 lines** (rule `GOD_CLASS`), in the bot and in `packages/shared`. Agent tools live in `*.tools.ts` factories (`buildXTools(deps)`, see `records.tools.ts`, `surface.tools.ts`), pure logic in its own module, and a stateful collaborator is a class constructed in the DI service's constructor with explicit dependencies (a class field, never a constructor default). A service stays an orchestrator.
- Runtime accessors (`getLlm`, `getGuildRules`, `getIntegrations`, `getSurfaceRuntime`, `getToolRegistry`, `bindRegistryRuntimeDeps`) break DI cycles. They are bound in a **provider's** `onBoot`.

### Generic interaction engine (`modules/surface/`)

All business UIs (tickets, polls, giveaways, verification, temp voice...) are built ON DEMAND by the agent from primitives, never hard-coded:

- `InteractiveSurface` - persistent layout + state (DB-backed, survives restarts); editable by `surfaceId` OR `messageId`
- `InteractionBinding` - per-button access policy + action pipeline
- `ScheduledTrigger` - BullMQ-backed timers with guaranteed catchup after reboot
- `EventTrigger` - reactions, voice joins, member updates (10 event types)
- Error messages from surface tools are actionable: offending Zod path, valid binding keys, the identifier that was looked up (`surface.errors.ts`)

### Multi-provider engine (`modules/providers/`)

Each guild connects providers and binds each capability to one of their models. No vendor is hard-coded:

- Tables `GuildProvider` (slug, protocol, baseUrl, auth type, key encrypted with AES-256-GCM, options, cached catalog) and `CapabilityRoute` (one per guild capability: `chat.default`, `chat.reasoning`, `chat.ingestion`, `image.generate`, `image.edit`, `music.generate`, `tts.speak`, `video.generate`, `web.search`, any `custom.*`; model, optional fallback provider and model, params).
- **Adapters** (one stateless class per protocol, registered in `ProviderAdapterRegistry` by `ProvidersBoot`): `OpenAiCompatibleAdapter`, `AnthropicMessagesAdapter`, `KieUnifiedAdapter`, `GenericHttpAdapter` (templated REST operations described in the provider options). Contract in `AbstractProviderAdapter`: `testConnection`, `discoverModels`, `execute`, `chat`. A key never leaves an adapter (results, errors and logs are redacted).
- **`CapabilityRouterService`**: resolves the active route of a capability, lists the attempts (`attemptsOf`), runs a capability with an automatic fallback (`runCapability`), hands out the credentials of a capability outside conversation (`credentialsFor`).
- **`LlmService` is an orchestrator** (assistant module): `planRequest` decides ONCE per request whether it reasons (`preferReasoning`) and its effort; each turn goes to the route's provider and model (`ChatEndpointPlanner`), with the same route on every turn of the loop. `ChatTransport` serves the SSE-capable protocols itself and bridges the others to their adapter.
- **Fallback rule** (`isFallbackWorthy`): rate limit (429), server error (5xx), network failure, timeout, and only before any text was published. A refused key or an exhausted quota never falls back: the administrator must fix it.
- **Instance config is the bootstrap**: env `LLM_*` or the owner modal. On the first resolved request of a guild, `ProviderLegacyMigration` copies it into that guild's providers and routes (once per guild, audit `provider.legacy_migrated`). Copies carry a `_source` marker and follow the instance when it changes (`reconcileInstance`, at boot and on save). The old integration code is not removed.
- **Linked conversation routes** (`provider-route.links.ts`): `chat.reasoning` and `chat.ingestion` follow a change of `chat.default` as long as they shared its exact target (provider, model, no fallback, same params). Reason: the intent heuristic sends most real sentences to `chat.reasoning`, so rebinding the default alone would look ineffective. Once an administrator binds one of them separately, it is independent. `bindRoute` returns `{ followedBy }`.
- Binding a route with only `{ providerId, modelId }` keeps its existing fallback and params; an explicit `fallbackProviderId: null` removes the fallback.
- **Hub panel** (`ProviderHubPresenter` + `handlers/provider-hub.*.handlers.ts`, in the `config-bot` thread): three `StringSelectMenu` (provider, capability, model, catalog paginated by 25) and guarded buttons/modal. Owner or Administrator only (`GuildAdminPolicy`).
- **Tools**: `provider.list/upsert/delete/test/models`, `capability.bind/list`, `providers.panel`. Keys typed in natural language stay visible in the Discord message: the system prompt steers key entry to the hub modal.
- Music, kie images and PixelLab read their key, base URL and model from the guild's route (`credentialsFor`), so a guild can rebind them.

### Other pillars

- **Encrypted integrations** (`modules/integrations/`): `IntegrationService` + AES-256-GCM (`shared/crypto/secret-box.ts`). The instance configuration (LLM/PixelLab/kie), connectable from Discord by owner OR admin; DB config overrides env bootstrap. Saving the LLM key goes through `LlmService.applyConfig` (connection check + in-memory reload + encrypted persistence + realignment of the guild copies). `IntegrationService.upsert` alone only writes the DB.
- **Guild rules** (`modules/rules/`): free zones, strictMentionElsewhere, confirmDestructiveActions, blockedChannelIds, custom instructions. Read in code by the gate and the registry, injected into the system prompt.
- **Per-guild agent settings** (`modules/guild-config/`): `AgentSettingsService` (thinking mode, config thread) and `ConfigThreadService` (private `config-bot` thread; tools `config.panel`, `server.overview`, `config.thinking`). A request for "the configuration" shows only what is applied on that guild (rules, skills, integrations with their models, thinking mode): never keys, never the blueprint catalog, never the legacy config sections.
- **Thinking** (`modules/assistant/llm-thinking.ts`, decided by `LlmService.planRequest`): STABLE per request. `preferReasoning` is decided once from the guild setting (`adaptive` by default: on for action requests only) and never changes during the loop; it selects the `chat.reasoning` route when the guild has one, `chat.default` otherwise. The `reasoning_effort` value is decided against the provider that will run the request, and sent only to endpoints that accept it (DeepSeek, Anthropic).
- **Request intent** (`request-intent.ts`, lexicon in `request-intent.lexicon.ts`): an action needs an explicit signal, else the request is plain conversation. Three signals: a matched recipe, an action verb (mutate, create, configure, schedule), or a mutating tool written in the request. A tool merely routed by keyword overlap is NOT a signal: with 171 tools, the old rule sent 109 of 113 turns of one night to `chat.reasoning`. A question (`comment`, `quel`, `est-ce que`...) ignores the verbs and recipes that follow its marker, unless a polite capability preface opens the request (`est-ce que tu peux`, `pourrais-tu`, `peux-tu`). Verbs match whole words with Unicode boundaries (the native word boundary is ASCII and never matches before an accent: `éditer`, `épingler`). The bare verb `mettre` is not in the lexicon, only `mettre à jour` and `mettre en place`; verbs that double as a noun (`active`, `archive`, `poste`, `programme`, `règle`) count only at the start of the request or after a subject. Read-only tools are listed in `READ_ONLY_NAME_RE`: a new read tool must be added there, or writing its name in a request would count as an action.
- **Silent investigation** (`modules/assistant/investigation.policy.ts`): a research read (web search, news, page fetch, repository) is not narrated in the status line. `[SOURCES] Je consulte mes sources...` is shown once, then nothing until the answer. Actions and server reads keep their `[TOOL]` line. `search_tools` and `search_skills` are narrated.
- **Skills** (`modules/agent/`): 135 `SkillBlueprint` recipes in 10 domain files (tool references verified at compile time through `RegisteredToolName`), `search_skills`, learning loop (`SkillPatternDetector`).
- **Memory** (`modules/memory/`): consolidated member/guild profiles (LLM curator with budget and anti-wipe guards), full opt-out, guild history ingestion at GuildCreate.
- **Records** (`modules/records/`): typed store over Prisma. 7 native collections (reminders, suggestions, quotes, faq, counters, notes, component_votes) plus any well-formed dynamic collection a recipe needs (`CollectionQuotaPolicy`: 50 collections and 10 000 records per guild, bounded JSON document).

## Gotchas

### Spraxium runtime

- **The framework never instantiates module classes.** Only `providers`, `listeners` and `handlers` are instantiated and lifecycle-registered. A constructor, `onBoot`, `onReady` or `onShutdown` inside a `@Module` class NEVER runs. Put runtime bindings in a provider's `onBoot`. Three modules carried dead code this way, including the wiring of the destructive-action confirmation, which therefore never fired from day one. `arch-audit` now rejects the pattern (`LIFECYCLE_ON_MODULE`).
- **Interaction handlers need their decorators.** A handler class listed in `handlers: [...]` but without `@ButtonHandler` / `@ModalHandler` / `@StringSelectHandler` (and a matching `@Button` / `@ModalComponent` / select component class) receives nothing from the dispatcher. The dispatcher calls the method named `handle`, with parameters injected by `@Ctx`, `@ButtonParams`, and similar decorators.
- **VALUE imports for injected classes.** `import type` strips the class from `design:paramtypes` → the token becomes `Object` → ModuleLoader fails at boot. Recurred 4+ times (Client, IntegrationService).
- **No default value on a constructor parameter of a DI class.** Same symptom (token `Object`). Instantiate pure helpers such as presenters as class fields instead.
- **`@Global` for cross-module services** - a non-global shared module only exports into the FIRST importer's container.
- A module cannot import another module that loads earlier in `AppModule` to reach its services (temporal dead zone at boot). Use a runtime accessor bound by the owning provider.
- Decorator-critical tsconfig flags: `experimentalDecorators`, `emitDecoratorMetadata`, **`useDefineForClassFields: false`** - do not modernize.
- Boot hooks use `SpraxiumOnBoot` (not `OnModuleInit`), and only on providers, listeners and handlers.
- Handler not firing? Check in order: decorator metadata → class listed in `handlers` → module reachable from `AppModule` → gateway intents → custom id.

### Data and LLM

- **Prisma + SQLite stores DateTime as integer epoch milliseconds.** `strftime('%Y-%m-%d', "createdAt")` returns NULL; use `"createdAt" / 1000, 'unixepoch'`. `MIN`, `COUNT` and `SUM` come back as **BigInt**: convert with `Number()` before any arithmetic, and never let a BigInt reach a tool result's `data` (serialize with `stringifySafe` from `shared/utils/object.ts`).
- `reasoning_effort` and other optional provider fields are rejected with a 400 by several OpenAI-compatible endpoints: omit them unless configured and compatible.
- `packages/shared` must be built (`pnpm --filter @10cordes/shared build`) before bot typecheck/dev - the bot imports its `dist/`.
- **`user_id` in the chat body goes to DeepSeek only** (`buildChatRequestBody`, keyed on the host). It is not an OpenAI field: a strict endpoint rejects the whole request with a 400.
- Host rules are exact: `deepseek.com` and its subdomains (`isDeepSeekHost` in `shared/llm/chat-utils.ts`), never a look-alike domain.
- Every provider failure is typed. `ProviderError.kind` (`provider.types.ts`) comes from adapters, `ProviderHttpError`/`ProviderUnavailableError`/`ProviderTimeoutError`/`ProviderAuthError`/`QuotaExhaustedError` (`llm.errors.ts`) from the protocols the client serves itself. The fallback decision reads both through `isFallbackWorthy`; a new error class must be classified there.
- The LLM usage log (`logs/llm.jsonl`) carries `provider`, `model` and `fallback`: the model that actually answered, read from `ChatCompletionResult.served`.
- **French apostrophes in strings: `\u0027`, never `\u0029`.** `\u0029` is a closing parenthesis and compiles without any error, so the text reads « d)un » (153 occurrences swept on 2026-11-23). After writing French text, `grep -rlF '\u0029' --include='*.ts' apps/bot/src packages/shared/src` must return nothing.
- Editing the wording of a blueprint `trigger` makes the seed create a new row and purge the old one. The seed (`skill-blueprint.library.ts`) reactivates a purged library row whose trigger is back in the catalog, unless the staff deleted it (audit trail of the `deleteSkills` tool).
- Zod: nested defaults need **`.prefault({})`**, not `.default({})`. Zod 4 recursive types: declare manual union types.
- Prisma **6 pinned** (v7/v8 changed config and migration workflow); SQLite has no Json type → String column + `JSON.parse/stringify` at service level.
- Migrations on the dev DB are applied by hand (`prisma db execute` + `prisma migrate resolve`), never with a reset: that DB holds encrypted keys and real guild rules.

### Testing and rigs

- **A rig proves nothing by checking that a tool was called.** Check `ok: true` in the audit row `assistant.tool.<name>` (its metadata carries `ok` and `summary`), and keep failed tool calls visible in the scenario note. Name-only checks reported PASS on failing tools for a whole afternoon.
- A rig must assert something created DURING the scenario, not a row left over from an earlier run.
- **Never rebuild or restart the bot while a rig is running**, and boot the bot after any change to a DI constructor before trusting a rig.
- Component clicks and modal submits cannot be simulated from a rig (a real Discord interaction is required). Cover them with unit tests on the handler (metadata, policy guard, effect) and say plainly that the real click is unverified.
- `sync-tool-names.mjs` scans `name: '...'` literals in tracked sources: a fake tool in a spec file would enter `REGISTERED_TOOL_NAMES`. Use a constant for the name. `pnpm check:tools` (in `verify` and CI) fails when `registry-names.ts` is stale; a new source file must be known to git (`git add -N`) to be scanned.
- Rigs: `e2e-gate.mjs`, `e2e-full-suite.mjs`, `e2e-surface.mjs`, `e2e-providers.mjs` (multi-provider engine: migration, inventory, connection test, model change, automatic fallback, hub panel). `E2E_ONLY=name` runs one scenario.
- A provider that must fail on purpose in a rig: base URL `https://192.0.2.1/v1` (documentation address, never reachable). Local mock servers are refused by design by the outbound request guard.
- Every scenario in a rig must restore what it changed (rule toggles, probe channels, test surfaces).
- Every conversational scenario of `e2e-full-suite.mjs` reports its LLM turns (rows of `logs/llm.jsonl` between the `tools.selected` and `assistant.reply` audits) and the capability that served them. `tickets.surface` passes only under 5 turns, without the step ceiling, and deletes the surface it created.
- `pnpm lint` is two passes. The TypeScript pass (`eslint.ts.config.mjs`) enables four rules only (`no-floating-promises`, `await-thenable`, `no-unused-vars`, `no-explicit-any`): a violation is fixed, never disabled. The `@bluzzi` TypeScript block stays off because `typescript` is not installed at the root: `pnpm exec eslint --print-config apps/bot/src/main.ts | grep -c "@typescript-eslint"` must print 0. The pass types through the tsconfig files, so `lint` builds `@10cordes/shared` first.

### Environment and tooling

- `dev.exclude` must keep `.spraxium/**` and `dist/**` (watcher restart loops otherwise).
- Env files: `.env.local` > `.env` > `process.env`; no variable interpolation. `process.env` access outside config files is an arch-audit violation.
- Artifacts: `.spraxium/` build, `data/` SQLite DB, `logs/` JSONL, `.mimosa/` hook state - all gitignored.
- In Git Bash on Windows, a grep pattern that starts with `/` (such as `/setup`) is rewritten into a Windows path and silently matches nothing. Use a character class (`[/]setup`) or `grep -F`.
- The bot runs from `.spraxium/dist`: rebuild and restart after any fix, and stop every bot process before dropping a database table (a stale process kept querying a dropped table and spammed the framework's default error).
- Starting the bot from a shell: `pnpm start` in `apps/bot`. Find bot processes with a PowerShell CIM filter on `node.exe` and a command line matching `spraxium|10cordes`.

### Product rules

- Discord API: reply to the ADDRESSED message via `messageReference`. Generated media = ONE real attachment, never URLs in progress or summary (each mp3 URL renders a player).
- Adding a slash command is a regression: the registry is purged at boot and the product is conversation-only.
- No em-dashes in replies, markdown, commits or user-visible strings.
