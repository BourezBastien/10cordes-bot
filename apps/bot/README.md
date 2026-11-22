# 10cordes-bot · apps/bot

The Spraxium bot: an agentic Discord administrator with **zero slash commands**,
technical modules, a REST API and Discord OAuth (better-auth) for the web
dashboard.

## Run

```bash
pnpm dev      # from the repo root: builds @10cordes/shared then starts spraxium dev
pnpm build    # production bundle -> .spraxium/dist/src/main.mjs
pnpm start    # production: `spraxium start` (ConfigLoader reads .spraxium/dist/spraxium.config.js)
```

**Never** start `node .spraxium/dist/src/main.mjs` directly: the ConfigLoader
re-reads `spraxium.config.ts` and the bare ESM import fails.

Environment lives in `.env` (see `.env.example`). Required: `DISCORD_TOKEN`.
Optional: `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` / `DEEPSEEK_EFFORT` (agent
brain), `PIXELLAB_API_KEY`, `REDIS_URL` (BullMQ durable queue; in-memory
fallback), `HTTP_API_KEY` (set `HTTP_HOST=0.0.0.0` in Docker),
`BETTER_AUTH_SECRET` + `DISCORD_CLIENT_SECRET` (dashboard),
`DISCORD_BOT_NAME` (plain-text name trigger), `E2E_ENABLED` + `E2E_GUILD_ID`
+ `E2E_STAFF_WEBHOOK_IDS` (dev-only test rig; ONLY these webhooks pass the
gate).

Enable the **MESSAGE CONTENT** privileged intent in the Discord developer portal.

## How the agent works

- **Triggers (gate refondue 22/11)**: real mention, bot name typed as plain
  text (whole word), verified reply to one of its messages, or any human
  message in the dedicated AI channel. Webhooks must be allowlisted
  (`E2E_STAFF_WEBHOOK_IDS`); messages mentioning another bot are ignored.
  No passive LLM triage anymore.
- **Direct execution**: no plans, no confirmation panels. Each destructive tool
  re-checks the requester's Discord permission and the bot's, archives before
  deleting, and audits everything (`agent.action.direct` / `agent.action.denied`).
- **Replies are plain text** in the request channel. No DMs, no portals.
  Silence on request (`skipReply` tool + deterministic regex). `[PANEL]` prefix
  renders a V2 panel for structured data.
- **Memory**: consolidated profiles per member and per server
  (`member_memory_profiles` / `guild_memory_profiles`, LLM curator with
  budget/anti-wipe/attribution guards in
  `src/modules/memory/memory-curator.service.ts`); raw journal kept in
  `member_memories` / `guild_memories`. Mentioning a user injects their profile.
- **Skills**: official library seeded per server at boot
  (`src/modules/agent/skills.library.ts`, 25 skills) plus member-created ones
  (`createSkill`/`openSkill`/`listSkills`/`deleteSkills`). Triggers render in
  every prompt (one line each, data zone); rules prime over style, never over
  security.
- **Automations**: `createAutomation` (Discord event -> 1-5 actions with
  template vars), executed by listeners in `src/modules/automations/`.
- **Web tools** (all no-auth, rate limits documented in descriptions):
  searchInternet, news RSS (Le Monde/France24), Wikipedia, jokes FR/EN, memes,
  facts, quotes, trivia, holidays (Nager.Date), currency (Frankfurter),
  countries, dictionary, lyrics, IP lookup, color schemes, PDF generation
  (pdfkit), GitHub repo/profile + gitdiagram links, disdex index, PixelLab.
- **Costs**: response cache (identical question in a guild within 30 min =
  cached reply, `llm.cache.hit` audited), token accounting per call
  (`llm.usage` with cause reply/web/consolidation/triage), provider errors
  typed (402 quota / 401 auth / 5xx) with honest user notices.

## What is inside

```
src/
  main.ts                  entry: console mirror to bot-out.log, exit/signal tracers
  app.module.ts            module tree (infra modules are @Global)
  app.env.ts               typed env (@Env decorators, secrets masked)
  auth/                    better-auth instance, session/guild guards, validated-env accessor
  modules/
    agent/                 direct-execution tools, skills service + library, whitelist
    assistant/             conversational agent: triggers, BullMQ queue, LLM loop,
                           reply cache, web agent (dashboard), response delivery
    automations/           event -> actions engine built by the agent
    health/                /healthz + HealthMonitor (state-change alerts)
    webtools/              no-auth web API tools (search, fun, data, files)
    api/                   /api/v1 guild endpoints (config, modules, audit, stats, chat)
    tool-registry/         shared registry: permission gates, audit
    memory/                journal + consolidated profiles + curator
    logging/ tickets/ roles/ welcome/ moderation/   technical event modules
    database/ guild-config/ module-manager/ audit/ locale-* removed (skills-first)
  shared/                  UI helpers (Components V2), template engine, safe-fetch
scripts/
  guardian.mjs             health check + auto-relaunch + /healthz probe (silent)
  e2e-write.mjs            write-tool battery (dev server only, self-healing webhook)
```

## Technical modules (what remains)

logging (event logs), tickets (button-driven ticket system), roles (reaction
role menu), welcome (templates), moderation (cases), plus infra: database,
audit, guild-config, module-manager, tool-registry, imagelab, automations,
assistant, agent, health, webtools. Removed as superseded: levels, setup,
tags, locale, i18n.

## Module contract

1. Scaffold `src/modules/<feature>/`, export `<feature>.module.ts`
2. Register in `app.module.ts` (technical/event modules only - behavior goes
   in skills)
3. Agent tools: implement `SpraxiumOnBoot`, register `BotTool`s in
   `ToolRegistryService` with `permissions[]` and `scope` (`guild` or `user`)
4. Status tools follow the `get<Feature>Setup` naming and the shared
   `makeStatusTool` factory

Gotchas: infra modules must be `@Global()`; `@Listener` classes need `@On()`;
`import type` for DI-injected classes turns the token into `Object` (import
values); tool names must be slug-safe for the LLM API (`.` gets encoded);
Prisma in scripts needs `DATABASE_URL` from process.env; `pnpm start
--force-unlock` daemonizes without stdio (hence the bot-out.log mirror).
