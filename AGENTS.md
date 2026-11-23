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

- **Framework source (version of record):** `C:\Users\Bastien\Documents\Projects\Discord Bot Framework examples\spraxium` - packages in `packages/`, runnable examples in `apps/`, ORM scaffolds in `templates/database/`. If docs disagree with installed behavior, trust this source.
- **Docs site source:** `...\Discord Bot Framework examples\spraxium-docs` (locales `en/es/pt`) - full doc map inside.
- **Reference bots (read-only inspiration):** `...\Discord Bot Framework examples\reference-bots\` - skyra (settings/i18n patterns), discord-tickets (Prisma/i18n/tickets), CorwinDev+saiteja (multipurpose patterns + anti-patterns), Discord-AI-Bot (per-channel AI memory, triage gate, typed tools), wardhive (typed action queue, RBAC guards, audit service, geolock).

## Commands (run at repo root unless noted)

```bash
pnpm dev            # builds @10cordes/shared then spraxium dev (in apps/bot)
pnpm build          # build all workspaces (shared → dist, then spraxium build → .spraxium/dist)
pnpm typecheck      # tsc --noEmit in every workspace (bot typecheck builds shared first)
pnpm test           # vitest (packages/shared has the suites; bot uses --passWithNoTests)
pnpm lint           # eslint (@bluzzi/eslint-config, flat config in eslint.config.mjs)
pnpm verify         # lint + typecheck + test + build + check:modules + arch:audit
pnpm arch:audit     # POO compliance check (exit 1 on violations)
pnpm --filter 10cordes-bot exec prisma migrate dev   # DB migrations (Prisma 6 pinned)
node apps/bot/scripts/diagnose.mjs [days]            # JSONL log forensics
```

## Architecture

- `apps/bot/src/main.ts` - only file touching `SpraxiumFactory`: validate env → create → `useModule(AppModule)` → `provide(AppEnv)` → `listen()` → purge Discord slash-command registry at boot.
- `apps/bot/src/app.module.ts` - root module; every feature module must be in `imports`. Infra modules (memory, records, queue, rules, integrations) are `@Global`.
- `apps/bot/src/app.env.ts` - `@EnvSchema()` extending `SpraxiumBaseEnv`. Generic `LLM_API_URL/KEY/MODEL/EFFORT` (no vendor prefixes); `DISCORD_TOKEN` is the only required var.

### Conversation pipeline (the product)

Message → gate (ignore bots/self/webhooks unless test allowlist; `GuildRule.blockedChannelIds` = total silence; free zones vs strict mention elsewhere) → queue (FIFO per user, 3 parallel) → `AgentLoop` (max 12 iterations + synthesis fallback) → typed tools (`search_tools` expands the core ~14 set) → `DiscordProgressiveResponder` (1.8s throttle, single edit chain) → audit + FileLog JSONL.

### POO layer (audited by `arch-audit`)

- **Policy** (`src/core/security/access-policy.ts`): `BaseAccessPolicy<TCtx>` → `GuildAdminPolicy`. The ONLY place Discord permissions are checked; `PermissionFlagsBits`/`guild.ownerId` anywhere else is a violation.
- **Presenter** (`modules/*/presenters/`): pure classes, data in → Components V2 payload out. No API calls, no side effects. Services never build UI.
- **Handler** (`modules/*/handlers/`): interaction routing - policy guard → ephemeral error → service delegation.

### Generic interaction engine (`modules/surface/`)

All business UIs (tickets, polls, giveaways, verification, temp voice...) are built ON DEMAND by the agent, not hard-coded:

- `InteractiveSurface` - persistent layout + state (DB-backed, survives restarts)
- `InteractionBinding` - per-button access policy + action pipeline
- `ScheduledTrigger` - BullMQ-backed timers with guaranteed catchup after reboot
- `EventTrigger` - reactions, voice joins, member updates (10 event types)
- Only 3 interaction handlers exist at boot: `surface:act` / `surface:select` / `surface:modal` (+ `integration-config`)

### Other pillars

- **Encrypted integrations** (`modules/integrations/`): `IntegrationService` + AES-256-GCM (`shared/crypto/secret-box.ts`). LLM/PixelLab/kie keys connectable from Discord by owner OR admin; DB config overrides env bootstrap.
- **Guild rules** (`modules/rules/`): free zones, strictMentionElsewhere, confirmDestructiveActions, blockedChannelIds, custom instructions - consulted in code before every action and injected into the system prompt.
- **Skills** (`modules/agent/`): 47 `SkillBlueprint` recipes (typed tool references via `RegisteredToolName`), `search_skills` scoring, learning loop (`SkillPatternDetector` proposes skills after 3+ repeated patterns).
- **Memory** (`modules/memory/`): consolidated member/guild profiles (LLM curator with budget/anti-wipe guards), full opt-out, guild history ingestion at GuildCreate.
- **Records** (`modules/records/`): typed store over Prisma (Zod collections), archives before any deletion.

## Gotchas

- **Spraxium DI: VALUE imports for injected classes.** `import type` strips the class from `design:paramtypes` → token becomes `Object` → ModuleLoader fails. This bit us 4+ times (Client, IntegrationService).
- **`@Global` for cross-module services** - a non-global shared module only exports into the FIRST importer's container.
- Decorator-critical tsconfig flags: `experimentalDecorators`, `emitDecoratorMetadata`, **`useDefineForClassFields: false`** - do not modernize.
- `isolatedModules` → `import type` for type-only imports (types are fine erased; DI classes are not, see above).
- **`packages/shared` must be built (`pnpm --filter @10cordes/shared build`) before bot typecheck/dev** - the bot imports its `dist/`.
- Zod: nested defaults need **`.prefault({})`**, not `.default({})` (default short-circuits and skips inner defaults). Zod 4 recursive types: declare manual union types instead of self-referencing schemas.
- Prisma **6 pinned** (v7/v8 changed config + migration workflow); SQLite has no Json type → String column + `JSON.parse/stringify` at service level.
- Handler not firing? Check: module reachable from `AppModule` → module catalog → gateway intents → custom_id exact match.
- Boot uses `SpraxiumOnBoot` (not `OnModuleInit`) for post-DI init.
- `dev.exclude` must keep `.spraxium/**` and `dist/**` (watcher restart loops otherwise).
- Env files: `.env.local` > `.env` > `process.env`; no variable interpolation. `process.env` direct access outside config = arch-audit violation.
- Artifacts: `.spraxium/` build, `data/` SQLite DB, `logs/` JSONL - all gitignored.
- Discord API: reply to the ADDRESSED message via `messageReference`, not a bare channel send. Generated media = ONE real attachment, never URLs in progress/summary (each mp3 URL renders a player).
- Adding a slash command is a regression: the registry is purged at boot and the product is conversation-only.
