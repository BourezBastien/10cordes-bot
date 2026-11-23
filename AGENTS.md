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
pnpm lint           # eslint (@bluzzi/eslint-config, flat config in eslint.config.mjs)
pnpm verify         # lint + typecheck + test + build + check:modules + arch:audit (all strict)
pnpm arch:audit     # strict POO report on apps/bot/src and packages/shared/src: exits 1 on ANY violation
pnpm --filter 10cordes-bot exec prisma migrate dev   # DB migrations (Prisma 6 pinned)
node apps/bot/scripts/diagnose.mjs [days]            # JSONL log forensics
```

`pnpm arch:audit` has no baseline and no ratchet: zero violation, enforced locally by `pnpm verify` and on every push by CI. Never weaken a rule or add an exception to pass it: fix the code.

## Architecture

- `apps/bot/src/main.ts` - only file touching `SpraxiumFactory`: validate env → create → `useModule(AppModule)` → `provide(AppEnv)` → `listen()` → purge Discord slash-command registry at boot.
- `apps/bot/src/app.module.ts` - root module; every feature module must be in `imports`. Infra modules (memory, records, rules, integrations, guild-config, assistant) are `@Global`.
- `apps/bot/src/app.env.ts` - `@EnvSchema()` extending `SpraxiumBaseEnv`. Generic `LLM_API_URL/KEY/MODEL/EFFORT` (no vendor prefixes); `DISCORD_TOKEN` is the only required var.

### Conversation pipeline (the product)

Message → gate (ignore bots/webhooks unless the test allowlist; `GuildRule.blockedChannelIds` = total silence; free zones vs strict mention elsewhere; social noise ignored without an LLM call) → queue (FIFO per user, 3 parallel) → `AgentLoop` (max 12 iterations + synthesis fallback) → `ToolRegistryService.run` → `DiscordProgressiveResponder` (1.8s throttle, single edit chain) → audit + FileLog JSONL.

`ToolRegistryService.run` gates, in order: required modules active → RBAC node `deny` → Discord permissions (unless node `allow`) → Zod validation → **destructive-action confirmation when the guild rule is on** → handler → audit. A failed tool becomes an explicit `{ ok: false, summary }` that the model relays; it never throws into the loop.

Tool routing (Anthropic pattern): a small core set is always visible, `search_tools` expands it on demand.

### POO layer (audited by `arch-audit`, strict)

- **Policy** (`src/core/security/`): the ONLY place Discord permissions, role membership and role hierarchy are read or compared. `GuildAdminPolicy` and `GuildManagerPolicy` (`access-policy.ts`, on a `GuildAccessContext`), `MemberPermissionPolicy` (a `GuildMember`), `PermissionNamesPolicy` (a list of permission names, i.e. `ToolRunContext.permissions` in jobs, triggers and the web channel), `BotPermissionPolicy` (the bot itself), `AdminOpPolicy`, `CollectionQuotaPolicy`. Elsewhere, build a context with `guildAccessContext`, `accessContextFromNames` or `interactionAccessContext`, and list names with `permissionsOf(member)`. The audit rejects any other read: `PermissionFlagsBits.`, `.permissions.toArray()`, `.permissions.has(`, `memberPermissions`, `.permissions.includes(`, `guild.ownerId ===`, `member.roles.cache.has(...)`.
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

### Other pillars

- **Encrypted integrations** (`modules/integrations/`): `IntegrationService` + AES-256-GCM (`shared/crypto/secret-box.ts`). LLM/PixelLab/kie keys connectable from Discord by owner OR admin; DB config overrides env bootstrap. Saving the LLM key goes through `LlmService.applyConfig` (connection check + in-memory reload + encrypted persistence). `IntegrationService.upsert` alone only writes the DB.
- **Guild rules** (`modules/rules/`): free zones, strictMentionElsewhere, confirmDestructiveActions, blockedChannelIds, custom instructions. Read in code by the gate and the registry, injected into the system prompt.
- **Per-guild agent settings** (`modules/guild-config/`): `AgentSettingsService` (thinking mode, config thread) and `ConfigThreadService` (private `config-bot` thread; tools `config.panel`, `server.overview`, `config.thinking`). A request for "the configuration" shows only what is applied on that guild (rules, skills, integrations with their models, thinking mode): never keys, never the blueprint catalog, never the legacy config sections.
- **Adaptive thinking** (`modules/assistant/llm-thinking.ts`, applied by `LlmService`): `reasoning_effort` is sent only on tool-bearing turns that are not the final synthesis, and only to compatible endpoints (DeepSeek, Anthropic). Per-guild setting, default `adaptive`.
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
- `sync-tool-names.mjs` scans `name: '...'` literals in tracked sources: a fake tool in a spec file would enter `REGISTERED_TOOL_NAMES`. Use a constant for the name.
- Every scenario in a rig must restore what it changed (rule toggles, probe channels, test surfaces).

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
