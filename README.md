<div align="center">

# 10cordes-bot

**The modular, agentic Discord bot - every feature is a module, the AI runs the server with you.**

Built on [Spraxium](https://github.com/spraxium/spraxium) (discord.js v14) · TypeScript · Prisma · Fully typed · Components V2 everywhere

[![CI](https://img.shields.io/github/actions/workflow/status/BourezBastien/10cordes-bot/ci.yml?branch=develop&label=CI)](https://github.com/BourezBastien/10cordes-bot/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933)](./package.json)
[![discord.js](https://img.shields.io/badge/discord.js-14-5865f2)](https://discord.js.org)
[![pnpm](https://img.shields.io/badge/pnpm-monorepo-F6921E)](./pnpm-workspace.yaml)

</div>

---

## What makes it different

- **An AI agent runs the server with you.** Mention it and ask: it checks your permissions, chains its tools, and answers in a clean Components V2 panel. Destructive actions require a human confirmation. Outside the dedicated AI channel, answers arrive through an ephemeral portal visible only to you.
- **Everything is a module.** Enable/disable any feature live, globally and per server, with a dependency graph: disabling a module cleanly cascades to the modules that depend on it, unless they serve another active module.
- **A single `/setup` dashboard.** All options, grouped by category, rendered as Components V2 with integrated pagination - the slash-command mirror of what you can ask the agent in plain language.
- **Persistent memory.** Server-level and member-level memories (append-only) let the agent learn your rules, hierarchy and preferences - "present the server" works because it remembers.
- **Language follows the user.** `/lang` sets a personal language, auto-detected from the Discord client otherwise. Never imposed by the server.
- **60+ tools, permission-gated.** Channels, roles, members, messages, webhooks, audit logs, memory, levels, tags, image generation (PixelLab) - each tool declares the Discord permissions it requires and the registry refuses politely when you lack them.

## Commands

| Command | Description |
|---|---|
| `/setup` | Control panel: modules, welcome, logs, tickets, roles, levels, moderation, config, agent IA |
| `/lang` | Your personal language (fr/en) |
| `/help` | What the bot is and everything it can do |

Everything else happens by talking to the agent.

## Quickstart

**Requirements:** Node 22+ (or 24/26), pnpm 12, a Discord application token.

```bash
pnpm install
cp apps/bot/.env.example apps/bot/.env     # set DISCORD_TOKEN (+ DATABASE_URL optional)
pnpm --filter 10cordes-bot exec prisma migrate dev
pnpm dev                                   # shared package builds, then spraxium dev
```

Enable the **MESSAGE CONTENT** privileged intent in the Discord developer portal.

**Docker**

```bash
docker compose up -d
```

## Project structure

```
apps/bot          Spraxium bot + REST API (Hono) + better-auth (Discord OAuth) - see apps/bot/README.md
apps/dashboard    Web dashboard (React, planned - see apps/dashboard/README.md)
packages/shared   Zod schemas, dependency-graph engine, template engine (bot + dashboard)
references        Study repositories used for patterns (not part of the runtime)
docs/             ROADMAP (feature backlog) · ARCHITECTURE (deep dive)
```

Full architecture: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) · Feature backlog: [docs/ROADMAP.md](./docs/ROADMAP.md)

## Adding a module

1. Scaffold `apps/bot/src/modules/<feature>/` - `commands/`, `handlers/`, `<feature>.module.ts`
2. Register in the catalog: `module.catalog.ts` (`id`, `label`, `commands`, `dependsOn`, `recommends`)
3. Add its Zod schema + agent tools in `packages/shared` if it exposes new config or tools
4. Import the module in `apps/bot/src/app.module.ts` - done, it is toggleable like the rest

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md). Branch model: `main` (stable) <- `develop` (integration) <- `feature/*`. Conventional commits. CI (lint, module consistency, typecheck, tests) must pass on every PR.

## License

[MIT](./LICENSE)
