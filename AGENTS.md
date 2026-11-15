# AGENTS.md

## Project

**10cordes-bot** — a Discord bot built on the **Spraxium** framework (`@spraxium/*` v0.9.x), which wraps **discord.js v14** with a NestJS-style decorator/module system. Private, ESM (`"type": "module"`), pnpm, Node `^22 || ^24 || ^26`.

## Framework resources (read before adding features)

- **Framework source (monorepo, version of record):** `C:\Users\Bastien\Documents\Projects\Discord Bot Framework examples\spraxium` — packages in `packages/` (core, common, env, components, http, i18n, schedule, signal, logger, webhook, cli), runnable examples in `apps/` (slash-bot, guard-bot, components-bot, modal-bot, schedule-bot…), ORM scaffolds in `templates/database/`. If docs disagree with installed behavior, **trust this source**.
- **Docs site source (cloned from github.com/spraxium/docs):** `C:\Users\Bastien\Documents\Projects\Discord Bot Framework examples\spraxium-docs` — English docs in `en/<topic>/`, plus `articles/` and `changelogs/`. Locales: `en`, `es`, `pt`.
- **Doc map (`en/`):** `getting-started/` (modules, providers & lifecycle) · `slash-commands/` (options, subcommands, defer, autocomplete, guards) · `listeners/` · `guards/` · `exceptions/` · `configuration/` (config fields, dev loading, plugins) · `env/` · `cli/` · `components/` + `modals/` (buttons, selects, modals, embeds) · `prefix-commands/` · `schedule/` · `i18n/` · `http/` · `logger/` · `presence/` · `sharding/` · `signal/` · `webhook/`.

## Commands

```bash
pnpm dev            # spraxium dev — SWC watcher; behavior from `dev` block of spraxium.config.ts
pnpm build          # spraxium build — tsc --noEmit typecheck first, then tsdown → .spraxium/dist
pnpm start          # spraxium start — runs built artifact with NODE_ENV=production
npx tsc --noEmit    # typecheck only (no lint/test tooling is set up — don't invent any)
npx spraxium g <schematic> <name>   # scaffold + auto-register into the target module
```

Useful `spraxium g` schematics: `module` (m), `service` (s), `listener` (l), `slash-command` (sc) + `slash-handler` (sh) pairs, `guard` (gu), `button` (btn), `select` (sel), `modal` (md), `embed` (em), `task` (t) / `interval-task` (it). Module-scoped schematics prompt for a target module and auto-register; `module` itself does **not** auto-register — wire it into `AppModule.imports` yourself. Process lock: a second `dev`/`start` instance exits; use `--force-unlock` if stale.

## Architecture

- `src/main.ts` — only file touching `SpraxiumFactory`: validate env → `SpraxiumFactory.create({ token })` → `useModule(AppModule)` → `provide(AppEnv, env)` → `intents(IntentPreset.Standard)` → `listen()`.
- `src/app.module.ts` — root module; feature modules must be in its `imports` array or nothing inside them loads (silently).
- `src/app.env.ts` — `@EnvSchema()` class extending `SpraxiumBaseEnv` (which already declares `DISCORD_TOKEN`, optional `DISCORD_CLIENT_ID`, `NODE_ENV`). Add vars as `@Env('NAME', { default?, secret? })` + validators (`IsString`, `IsNumber`, `IsBoolean`, `IsDiscordId`, `IsPort`, `IsUrl`, `IsEnum`, `IsOptional`, …) from `@spraxium/env`. All fields are **masked by default** (`secret: true`) — pass `secret: false` for non-sensitive values.
- `spraxium.config.ts` + `config/*.config.ts` — `defineConfig((env) => ({...}))` from `@spraxium/core`. `env` derives from `NODE_ENV` read once at startup (`production` → isProd; `neutral|staging|test` → isNeutral; **anything else/unset → isDev**). Feature packages plug in via `plugins: [defineSchedule({...}), defineI18n({...}), ...]`; per-plugin factories live in `config/`.

### Runtime module toggling (`src/modules/module-manager/`)

Every feature module is toggleable at runtime via `/modules list|enable|disable` (Administrator-only), persisted to `output/module-states.json` (absent = enabled). The framework has no runtime load/unload — modules stay loaded and are soft-blocked instead:

- `module.catalog.ts` — **add an entry here when creating a feature module**: `{ id, label, description, commands: [root slash command names] }`. This is what lets the guard map a command to its module.
- `ModuleEnabledGuard` — registered globally in `main.ts`; blocks cataloged commands of disabled modules with `ModuleDisabledException`. Unknown commands pass through (keeps `/modules` itself reachable).
- `ModuleManagerService` (exported) — other modules inject it to check `isEnabled('<id>')` in **listeners** and component handlers (early-return when disabled; the guard only covers commands).
- Note: `ModuleStateStore` is an import-time singleton because global guards are `new`-instantiated per interaction without DI — do not `new` another store instance.

### Feature module convention (`src/modules/<feature>/`)

Follow `modules/ping/`. Command classes = schema only (no logic, no service imports); handler classes = logic only.

- `commands/<name>.command.ts` — `@SlashCommand({ name, description, defaultMemberPermissions?, dmPermission?, guild? })` class with empty `build()`; options are stacked `@SlashOption.<Type>(name, { description, required?, ... })` method decorators on `build()` (String/Integer/Number/Boolean/User/Channel/Role/Mentionable/Attachment). Subcommands: `@SlashSubcommand` on methods; groups: `@SlashSubcommandGroup` class + `@SlashSubcommandGroups([...])` stacked above `@SlashCommand` — group classes stay in the parent command file and are **not** listed in `commands`.
- `handlers/<name>-command.handler.ts` — `@SlashCommandHandler(CommandClass, { sub?, group? })` class with `handle()`. Params: `@Ctx()` for the interaction + typed option params (`@SlashStringOption('name')`, `SlashUserOption`, `SlashChannelOption`, …). Long work: `@Defer({ ephemeral? })` or `@AutoDefer({ threshold? })` (default 2000ms) on the handler class; reply via `interaction.reply()` either way. Autocomplete: `autocomplete: true` on the option + `@SlashAutocompleteHandler(Command, 'option')` class using `@SlashFocused()`, must always `interaction.respond(...)` (≤25 items).
- `<feature>.module.ts` — `@Module({ commands, handlers, providers, exports, listeners, imports })`. Only parent commands go in `commands`; handler classes in `handlers`.
- Services: `@Injectable()` classes in `providers`, injected by **constructor only** (no `new`); expose across modules via `exports` + consumer's `imports`. Cross-cutting infra only → `@Global()` module.
- Lifecycle: implement `SpraxiumOnBoot` / `SpraxiumOnReady(client)` / `SpraxiumOnShutdown` (type imports from `@spraxium/common`) on a service. Constructor = wiring only; I/O belongs in `onBoot` (whole DI graph resolves before Discord login).
- Listeners: `@Listener(Events.MessageCreate)` class — exactly one event per class — with `@On()` / `@Once()` methods receiving discord.js payload args directly; register in the module `listeners` array. Keep them thin: filter → pass IDs to a service.
- Guards: class implementing `SpraxiumGuard.canActivate(ctx)` with `@Guard()`; apply via `@UseGuards(...)` (class or method level) or `app.useGlobalGuards(...)`. Built-ins from `@spraxium/core`: `GuildOnly`, `DMOnly`, `OwnerOnly`, `PermissionGuard`, `RoleGuard`, `CooldownGuard` (ms!), `NoBotGuard`, `NSFWGuard`, `ThreadOnlyGuard`, `VoiceChannelGuard`; configure with `withOptions(Guard, {...})`. Return `false` for generic denial; throw a named exception for a specific user-facing reason.
- Errors: throw `SpraxiumException` subclasses (typed `props`, `{{placeholder}}` message interpolation) instead of try/catching expected failures; user-facing reply rendering is configured via `exceptions.layouts` in `spraxium.config.ts` (keys = exception class names — update the map when renaming).

## Gotchas

- Decorators are load-bearing: `experimentalDecorators` + `emitDecoratorMetadata` + **`useDefineForClassFields: false`** in `tsconfig.json`. Do not "modernize" these settings.
- `isolatedModules` is on — use `import type` for type-only imports (lifecycle interfaces, discord.js types).
- `tsconfig.json` only includes `src/`; `config/` and `spraxium.config.ts` sit outside the typecheck surface.
- A handler/command/listener referencing classes in a module that isn't reachable from `AppModule` is **silently ignored** — new feature not firing? Check registration first, then gateway intents (`MessageCreate` needs GuildMessages/DirectMessages; `GuildMemberAdd` needs GuildMembers).
- Option decorator name strings must match exactly between command definition and handler param, or the value silently arrives `null`.
- Reply within 3s (Discord limit) — use `@Defer`/`@AutoDefer` for slow handlers; never call `deferReply()` manually.
- `dev.exclude` must contain `.spraxium/**` and `dist/**` or the watcher restart-loops.
- Env files: `.env.local` wins over `.env`; `process.env` wins over both. No variable interpolation in env files.
- Renaming a slash command `name` creates a new Discord registry entry (use `guild: '<id>'` + force re-register for dev iterations).
- Build/dev artifacts live in `.spraxium/` (gitignored); `@swc/core` build allowed via `pnpm-workspace.yaml`.
