<div align="center">

# 10cordes-bot

**The agentic Discord bot: zero commands, you talk, it runs the server.**

Built on [Spraxium](https://github.com/spraxium/spraxium) (discord.js v14) · TypeScript · Prisma · Fully typed · Components V2 everywhere

[![CI](https://img.shields.io/github/actions/workflow/status/BourezBastien/10cordes-bot/ci.yml?branch=develop&label=CI)](https://github.com/BourezBastien/10cordes-bot/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933)](./package.json)
[![discord.js](https://img.shields.io/badge/discord.js-14-5865f2)](https://discord.js.org)
[![pnpm](https://img.shields.io/badge/pnpm-monorepo-F6921E)](./pnpm-workspace.yaml)

</div>

---

## What makes it different

- **100% conversation-driven.** No slash commands, no buttons to navigate. Mention the bot, type its name, or talk in the dedicated AI channel: it checks your permissions, chains its tools and answers directly. Every action re-verifies permissions in code, archives before deleting, and everything is audited.
- **Silent while working.** From the moment a request is accepted to its answer, the channel shows nothing but the typing indicator: no "thinking" line, no tool trace, no step announcement, no draft being written. The bot acts, then delivers the result once, as a reply to the request.
- **Generic interaction engine.** Tickets, polls, giveaways, verification gates, temp voice channels, all built on demand by the agent using `InteractiveSurface` (persistent layout + state), `InteractionBinding` (per-button access policies + action pipelines), `ScheduledTrigger` (BullMQ-backed, survives restarts), and `EventTrigger` (reactions, voice, member updates). Zero hard-coded business handlers.
- **Keys in the database, encrypted.** The provider keys (any OpenAI-compatible LLM such as DeepSeek, OpenAI or OpenRouter, plus kie.ai and PixelLab) live in the database, AES-256-GCM encrypted. Put them in `.env` for the first start: the boot imports them once, then they can be commented out of the file. A provider can also be connected or changed from Discord via a modal (server owners AND administrators), and takes effect immediately.
- **Multi-provider engine.** Each server connects its own AI providers (OpenAI-compatible, Anthropic Messages, kie.ai, or any REST API described by templated operations) and binds each capability to one of their models: conversation, reasoning, ingestion, image, music, speech, video, web search, or any custom one. A capability can have a fallback provider: a rate limit, a server error, a network failure or a timeout switches to it automatically, before any text was published. Four protocols ship as adapters, none is hard-coded in the agent.
- **A "Fournisseurs et modèles" panel.** In the private config thread, three select menus (provider, capability, model, catalog paginated by 25) and guarded buttons let an administrator add a provider (the key is typed in a modal, never in a channel), test a connection and change a model. The same operations exist in natural language (`provider.*`, `capability.*`).
- **Server rules enforced in code.** `GuildRule` per guild: free zones (bot responds without mention), strict mention elsewhere, destructive action plans (when the rule is on, destructive actions wait for ONE approval panel, the click executes them after re-checking the requester's permissions, and the model never executes them itself), muted channels (total silence even if mentioned). Rules are consulted before every action.
- **Action plans.** All the destructive actions of one request share a single ✅ Appliquer / ❌ Annuler panel, reserved to the requester and valid 15 minutes. The plan can be applied once; each action is revalidated at click time (permissions in the guild and in the target channel, role hierarchy) on the member as they are now, a server snapshot is archived first, and a refusal stops the plan with an honest count.
- **Skill blueprints.** 135 pre-built recipes across 10 domains (tickets with escalation, temp voice, anti-raid, giveaways, verification, counting games, casino...) with parameters overridable by natural language. `search_skills` finds the right recipe; the agent follows its workflow.
- **A configuration view that tells the truth.** Asking for the configuration shows only what is really applied on that server: active rules, applied skills, connected integrations, the providers of the server and the model bound to each capability (never the keys), in a private `config-bot` thread.
- **Stable thinking.** Whether a request reasons is decided once, before its first turn, from the server setting (`adaptive` by default: on for action requests, off for plain conversation and questions), and stays the same for the whole request. An action request matches a recipe, names an action to run, or spells a mutating tool. A request that reasons runs on the `chat.reasoning` route when the server has one.
- **Persistent memory with opt-out.** Consolidated profiles per member and per server (LLM curator with anti-wipe guards). "Oublie-moi" purges everything and blocks future collection.
- **Learning loop.** The bot detects repeated action patterns (3+ similar requests) and proposes creating a reusable skill.

## Quickstart

**Requirements:** Node 22+ (or 24/26), pnpm 12, a Discord application token.

```bash
git clone https://github.com/BourezBastien/10cordes-bot.git
cd 10cordes-bot
pnpm install

# Configure (ONE required variable)
cp apps/bot/.env.example apps/bot/.env
# Edit .env: DISCORD_TOKEN=your-token

# Enable MESSAGE CONTENT privileged intent in the Discord developer portal

pnpm dev          # development (hot reload)
pnpm build        # production build
pnpm start        # production run (from apps/bot)
```

**Never** start `node .spraxium/dist/src/main.mjs` directly: the ConfigLoader re-reads `spraxium.config.ts` and the bare ESM import fails.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | **YES** | (none) | Bot token (Discord developer portal) |
| `LLM_API_URL` | no | (none) | OpenAI-compatible base URL. Read ONCE, to fill an empty database (import only) |
| `LLM_API_KEY` | no | (none) | API key for the AI provider. Read ONCE, to fill an empty database (import only, then encrypted in DB) |
| `LLM_MODEL` | no | (none) | Model name. Read ONCE, to fill an empty database (import only) |
| `KIE_API_KEY` | no | (none) | kie.ai key. Read ONCE, to fill an empty database (import only) |
| `KIE_MODEL` | no | (none) | kie.ai music model. Read ONCE, to fill an empty database (import only) |
| `PIXELLAB_API_KEY` | no | (none) | PixelLab key (pixel art). Read ONCE, to fill an empty database (import only) |
| `LLM_EFFORT` | no | empty | Reasoning effort: low/medium/high |
| `ENCRYPTION_SECRET` | no | derived | AES-256-GCM key for DB secrets |
| `DATABASE_URL` | no | `file:../data/bot.db` | SQLite or PostgreSQL |
| `REDIS_URL` | no | empty (= memory) | Queue + cache. `redis://redis:6379` in prod |
| `PORT` | no | `3000` | HTTP server port |
| `HTTP_HOST` | no | `127.0.0.1` | Bind address. `0.0.0.0` in Docker |
| `HTTP_API_KEY` | no | (none) | API key header `x-api-key` |
| `DASHBOARD_ORIGIN` | no | `http://localhost:5173` | CORS origin for the dashboard |
| `BETTER_AUTH_SECRET` | no | (none) | Min 32 chars, required for dashboard |
| `DISCORD_CLIENT_ID` | no | (none) | OAuth client ID |
| `DISCORD_CLIENT_SECRET` | no | (none) | OAuth client secret |
| `E2E_ENABLED` | no | `false` | Dev test rigs only |

**Where the keys live**: in the database, encrypted (AES-256-GCM). The database has the absolute priority.

1. **First start (import only)**: put `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL` (and optionally `KIE_API_KEY`, `KIE_MODEL`, `PIXELLAB_API_KEY`) in `.env`, then start the bot. The boot imports each key into the database once (audit `instance.imported`), and every server known to the bot receives its default providers and routes. The lines can then be commented out of `.env`: an existing row is never rewritten, and once the database knows an integration the environment is ignored. **Keep `ENCRYPTION_SECRET` or `BETTER_AUTH_SECRET`**: it derives the key that decrypts the database.
2. **Instance, from Discord**: mention the bot without a configured AI provider → a Components V2 panel appears with a "Connecter un fournisseur IA" button (visible to owners AND administrators) → fill the modal → key is encrypted and takes effect immediately
3. **Per server**: ask for the "fournisseurs et modèles" panel in Discord, or say "ajoute OpenRouter, et utilise tel modèle pour la musique". Each server starts with a copy of the instance (its AI provider and kie.ai: conversation, image and music routes) and follows the instance when it changes. A provider or a route you created yourself is never touched, and on a copy a model you changed is kept.

**AI providers vs integrations**: a provider is a models API routed by capability (DeepSeek, OpenRouter, kie.ai...). An integration is a specialized API with its own tools: PixelLab (pixel art, `image.icon` / `image.emoji`). Images that are not pixel art go through the `image.generate` route with `generateImage`, whatever the provider bound to it. A family the provider catalog does not declare (voice, video on kie.ai today) stays "non routée" until an administrator binds it.

## Architecture

```
apps/bot/src/
  main.ts                    Bootstrap + slash command purge
  app.module.ts              Module tree (infra modules are @Global)
  app.env.ts                 Typed env (LLM_* generic, no vendor lock)
  core/
    security/access-policy   BaseAccessPolicy + GuildAdminPolicy (POO)
  auth/                      better-auth + guards
  shared/
    ui/                      Components V2 helpers (panel, text, separator)
    crypto/secret-box        AES-256-GCM encryption
    cache/                   ICacheStore (Redis + memory fallback)
    actions/                 Component action registry + runToolAsActor
  modules/
    assistant/               Agent: gate, AgentLoop (12 iter + synthesis),
                             SystemPromptBuilder (XML + SERVER_RULES),
                             streaming SSE, typing indicator,
                             one final delivery (ReplyDelivery)
    surface/                 Generic engine: renderer, surface:act/select/modal
                             handlers, triggers (BullMQ), event-router (10 events)
    rules/                   GuildRule store + tools (zones, confirmation, mute)
    integrations/            Instance configuration (AES-GCM) + Presenter + handlers
    providers/               Multi-provider engine: adapters (4 protocols), registry,
                             store, CapabilityRouterService (fallback), hub panel,
                             tools provider.* / capability.* / providers.panel
    agent/                   Discord tools, 47 SkillBlueprint, skill service
    records/                 Typed store (Zod collections)
    memory/                  Profiles + curator + opt-out + ingestion
    moderation/ logging/ ... Technical modules
packages/shared/             Zod schemas, BotTool<T>, SkillBlueprint types
apps/dashboard/              Web dashboard (React 19, Vite 8)
```

## POO layer (new)

- **Policies** (`core/security/`): `GuildAdminPolicy`, `GuildManagerPolicy`, `MemberPermissionPolicy`, `PermissionNamesPolicy`, `BotPermissionPolicy`, `AdminOpPolicy`, `CollectionQuotaPolicy`. The ONLY place where Discord permissions, role membership and role hierarchy are read or compared. `arch-audit` enforces this.
- **Presenters** (`modules/*/presenters/`): pure classes that receive data and return complete Discord payloads. No side effects, no API calls.
- **Handlers** (`modules/*/handlers/`): interaction routing with policy guard → error handling → business logic delegation. Handlers need the `@spraxium/components` decorators: the framework routes interactions through class metadata.
- **No file over 300 lines**, enforced by `arch-audit` (strict, 0 violation, run by `pnpm verify` and CI): agent tools in `*.tools.ts` factories, pure logic in its own module, stateful collaborators as classes built in the service's constructor, services as orchestrators.

## Diagnostic & logging

Everything is logged to structured JSONL files:
- `logs/bot-YYYY-MM-DD.jsonl`: every event (gate decisions, tool calls, surfaces, triggers, errors)
- `logs/llm.jsonl`: every LLM call (cause, model, tokens, latency, success)

```bash
node scripts/diagnose.mjs        # Today's summary: top errors, LLM p95, slowest tools
node scripts/diagnose.mjs 7      # Last 7 days
pnpm arch:audit                  # POO architecture compliance check
```

## Test rigs (development)

```bash
# With E2E_ENABLED=true in .env:
node scripts/e2e-gate.mjs         # Gate: webhooks, mentions, GitHub links
node scripts/e2e-features4.mjs    # Primitives: surfaces, random pick, composed poll, audit events
node scripts/tool-evals.mjs       # 8 canonical prompts
node scripts/e2e-surface.mjs      # Pivot: surface + trigger + reboot
node scripts/e2e-full-suite.mjs   # 11 conversation scenarios (E2E_ONLY=name to filter)
node scripts/e2e-providers.mjs    # Multi-provider engine: instance migration, inventory,
                                 # connection test, model change, automatic fallback, hub panel
```

Test webhooks are auto-created by the bot (named `agent-e2e-guardian`) and auto-recognized when `E2E_ENABLED=true`.

Every rig is strict: a tool only counts when it actually succeeded (`ok: true` in the audit), and failed tool calls stay visible in the note of each scenario. A check that only looks at whether a tool was called reports passing tests while the tool is failing.

## Docker

```bash
docker compose up -d
```

The Dockerfile builds the Spraxium bundle, copies config, and runs the compiled bot. `HTTP_HOST=0.0.0.0` is set by compose.

## Monorepo structure

```
apps/bot          Spraxium bot + REST API + better-auth
apps/dashboard    Web dashboard (React 19 + Vite 8 + Tailwind 4)
packages/shared   Zod schemas, BotTool<T>, SkillBlueprint, RegisteredToolName
docs/             Architecture docs, roadmap, audit reports
```

Dependency rule: `apps/bot → @10cordes/shared ← apps/dashboard`

**Dashboard design credits:** the web dashboard's graphic style (dark theme, accent hierarchy, layout patterns) draws heavy inspiration from [ARCHIVE-9 by LeoBdt](https://github.com/LeoBdt/ARCHIVE-9): not a copy, but its visual language was deliberately reused. The same language also guides our Discord Components V2 panels.

## License

MIT, see [LICENSE](./LICENSE)
