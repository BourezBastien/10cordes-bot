# 10cordes-bot · apps/bot

The Spraxium bot: modular Discord administration with an agentic AI layer, a
REST API and Discord OAuth (better-auth) for the future web dashboard.

## Run

```bash
pnpm dev      # from the repo root: builds @10cordes/shared then starts spraxium dev
pnpm build    # production bundle -> .spraxium/dist/src/main.mjs
NODE_ENV=production node .spraxium/dist/src/main.mjs
```

Environment lives in `.env` (see `.env.example`). Required: `DISCORD_TOKEN`.
Optional: `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` / `DEEPSEEK_EFFORT` (agent IA),
`PIXELLAB_API_KEY` (image generation), `HTTP_API_KEY`, `DASHBOARD_ORIGIN`,
`BETTER_AUTH_SECRET`, `DISCORD_CLIENT_SECRET`.

Enable the **MESSAGE CONTENT** privileged intent in the Discord developer portal.

## What is inside

```
src/
  main.ts                  entry: intents (MessageContent included), global module guard
  app.module.ts            module tree (order matters: DatabaseModule first, infra modules are @Global)
  app.env.ts               typed env (Zod-style @Env decorators, secrets masked)
  auth/                    better-auth instance + /api/auth/* controller + session guards
  modules/
    agent/                 agent admin: plans (human confirmation), tools, whitelist
    assistant/             conversational agent: mention/reply/dedicated-channel, queue, V2 answers
    audit/                 append-only audit log (every agent action)
    guild-config/          one typed Zod config document per guild (getConfig / setConfigValue)
    memory/                persistent server + member memory (append-only)
    module-manager/        module catalog, dependency graph, per-guild states, guard pipeline
    tool-registry/         shared tool registry: permission gates, audit, getAvailableTools
    ...                    welcome, logging, moderation, roles, tags, tickets, levels, imagelab, locale
  shared/                  UI helpers (Components V2), status-tool factory, safe-fetch
  i18n/                    locale store (fr/en, per user)
```

## The agent (assistant)

- Triggers: mention, dedicated AI channel (set in `/setup`), reply to one of its messages.
- 60+ tools, verb-first names (`createChannel`, `banMember`, `saveServerMemory`...),
  each declaring required Discord permissions; the registry refuses politely and audits.
- Destructive actions create a PLAN confirmed by buttons (owner + whitelist).
- Queue workers: per-user FIFO, 3 parallel jobs, silent ordering.
- Outside the dedicated channel, answers arrive through an ephemeral portal
  (button -> ephemeral V2 panel) so content never floods public channels.
- Persistent memory (guild + member) injected into every exchange.

## Module contract

1. Scaffold `src/modules/<feature>/`, export `<feature>.module.ts`
2. Register in `app.module.ts` and (if user-facing) in `module-manager/module.catalog.ts`
3. Agent tools: implement `SpraxiumOnBoot`, register `BotTool`s in `ToolRegistryService`
   with `permissions[]` (Discord flags) and `scope` (`guild` or `user` -> private answer)
4. Status tools follow the `get<Feature>Setup` naming and the shared `makeStatusTool` factory

Gotchas live in the repo wiki: infra modules must be `@Global()` (transitive loading
confines exports to the first loader's container), `@Listener` classes need `@On()` on
handler methods, and tool names must be slug-safe for the LLM API (`.` gets encoded).
