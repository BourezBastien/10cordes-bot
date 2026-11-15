# AGENTS.md

## Project

**10cordes-bot** - modular all-in-one Discord bot (slash commands only) built on the **Spraxium** framework (`@spraxium/*` v0.9.x, wraps discord.js v14). pnpm monorepo, ESM, Node 22/24/26, Prisma 6 + SQLite, Zod everywhere, **Components V2 as the default rendering** (no "v2" suffixes in names - it is the base UI, helpers live in `apps/bot/src/shared/ui`).

## Monorepo

```
apps/bot          Spraxium bot (+ REST API & better-auth at the API step)
packages/shared   @10cordes/shared - Zod schemas, dependency-graph engine, template engine
docs/             ROADMAP.md (feature backlog) · ARCHITECTURE.md (deep dive)
```

Dependency rule: `apps/bot → @10cordes/shared ← future dashboard`. Nothing hardcoded: config = Zod schemas in shared; strings flagged for i18n; durations via `parseDurationMs`.

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
pnpm --filter 10cordes-bot exec prisma migrate dev   # DB migrations (Prisma 6 pinned)
```

## Architecture

- `apps/bot/src/main.ts` - only file touching `SpraxiumFactory`: validate env → create → `useModule(AppModule)` → `provide(AppEnv)` → `useGlobalGuards(ModuleEnabledGuard)` → `intents(Standard)` → `listen()`.
- `apps/bot/src/app.module.ts` - root module; every feature module must be in `imports`.
- `apps/bot/src/app.env.ts` - `@EnvSchema()` extending `SpraxiumBaseEnv`; all fields masked unless `secret: false`.
- `apps/bot/prisma/schema.prisma` - `Guild` (settings JSON-as-String, Zod-parsed), `GuildModuleState` (enabled + constraints JSON), `UserLocale`. better-auth tables come later via CLI.

### Feature module convention (`apps/bot/src/modules/<feature>/`)

Command classes = schema only; handler classes = logic only; follow `modules/ping/` and `modules/guild-config/`.

1. **Register in the catalog** - `apps/bot/src/modules/module-manager/module.catalog.ts`: `{ id, label, description, commands: [root command names], dependsOn, optionalDeps?, recommends? }`. Unregistered = not toggleable.
2. Module file wires `@Module({ commands, handlers, providers, exports, listeners })`.
3. **The access pipeline** (global guard `ModuleEnabledGuard` → `ModuleManagerService.assertCommandUsable`) enforces, in order: catalog known → global on → guild on → **dependencies active** → user exempt → channel whitelist → required role → admin bypass → cooldown + role quotas. Unknown commands pass (system commands stay reachable).
4. **Guards get no DI** (framework `new`es them per interaction) - services reachable from guards expose a runtime accessor (`getModuleManager()` pattern in `module-manager.service.ts`).
5. **Per-user language** - never per-guild. Inject `LocaleService` (`modules/locale/`), resolve with `locales.resolve(userId, guildDefault)`.
6. **Rendering** - reply with `flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]` and `panel()`/`text()` from `src/shared/ui`. Plain `interaction.reply('string')` is legacy.
7. Config lives in `packages/shared/src/schemas/guild-config.ts` (`CONFIG_KEYS` drives `/config` autocomplete). New editable keys: schema + registry entry.

## Gotchas

- Decorator-critical tsconfig flags: `experimentalDecorators`, `emitDecoratorMetadata`, **`useDefineForClassFields: false`** - do not modernize.
- `isolatedModules` → `import type` for type-only imports.
- **`packages/shared` must be built (`pnpm --filter @10cordes/shared build`) before bot typecheck/dev** - the bot imports its `dist/`.
- Zod: nested defaults need **`.prefault({})`**, not `.default({})` (default short-circuits and skips inner defaults).
- Prisma **6 pinned** (v7/v8 changed config + migration workflow); SQLite has no Json type → String column + `JSON.parse/stringify` at service level.
- Option decorator name strings must match exactly between command definition and handler param, or the value silently arrives `null`.
- Handler not firing? Check: module reachable from `AppModule` → command in catalog (or intentionally uncataloged) → gateway intents.
- `dev.exclude` must keep `.spraxium/**` and `dist/**` (watcher restart loops otherwise).
- Env files: `.env.local` > `.env` > `process.env`; no variable interpolation.
- Artifacts: `.spraxium/` build, `data/` SQLite DB, `output/` module-state JSON - all gitignored.
- Renaming a slash command `name` creates a new Discord registry entry.
