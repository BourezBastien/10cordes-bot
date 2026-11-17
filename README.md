<div align="center">

# 10cordes-bot

**The agentic Discord bot - zero slash commands, you talk, it runs the server.**

Built on [Spraxium](https://github.com/spraxium/spraxium) (discord.js v14) · TypeScript · Prisma · Fully typed · Components V2 everywhere

[![CI](https://img.shields.io/github/actions/workflow/status/BourezBastien/10cordes-bot/ci.yml?branch=develop&label=CI)](https://github.com/BourezBastien/10cordes-bot/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933)](./package.json)
[![discord.js](https://img.shields.io/badge/discord.js-14-5865f2)](https://discord.js.org)
[![pnpm](https://img.shields.io/badge/pnpm-monorepo-F6921E)](./pnpm-workspace.yaml)

</div>

---

## What makes it different

- **An AI agent runs the server with you, in plain language.** Mention it, type its name, or talk in the dedicated AI channel: it checks your permissions, chains its 80+ tools and answers directly in the chat. Every action re-verifies permissions in code (yours and the bot's), archives before deleting, and everything is audited.
- **No confirmation ceremony.** Explicit request + permissions = immediate execution and a plain-text result. No plans, no approval buttons, no ephemeral portals, no DMs.
- **Skills-first architecture.** Official skills (seeded per server: tickets, polls, moderation, trust score, welcome flows...) make the agent ask the right questions, recap, then build entire systems with its tools and wire recurring triggers as automations. Members can create their own skills and correct the agent's memory in conversation.
- **Persistent memory.** Consolidated profiles per member and per server (LLM curator with anti-wipe and attribution guards) drive personalized answers and recommendations.
- **Passive listening.** In the dedicated AI channel the agent follows the conversation and replies when relevant, without being named.
- **80+ tools, permission-gated.** Channels, roles, members, messages, moderation, web search, news RSS (Le Monde/France24), Wikipedia, jokes/memes/trivia (FR/EN), PDF generation, weather, currency, holidays, GitHub, disdex, PixelLab - every tool documents its required permissions and rate limits, and every web fact is cross-checked with sources cited.

## Quickstart

**Requirements:** Node 22+ (or 24/26), pnpm 12, a Discord application token.

```bash
pnpm install
cp apps/bot/.env.example apps/bot/.env   # fill DISCORD_TOKEN at minimum
pnpm dev                                  # builds @10cordes/shared then starts spraxium dev
```

Enable the **MESSAGE CONTENT** privileged intent in the Discord developer portal.
Optional keys: `DEEPSEEK_API_KEY` (agent brain), `PIXELLAB_API_KEY` (pixel art),
`REDIS_URL` (durable queue; falls back to in-memory), `HTTP_API_KEY`,
`BETTER_AUTH_SECRET` + `DISCORD_CLIENT_SECRET` (dashboard login).

## Repository

```
apps/bot          The Spraxium bot (agent, technical modules, REST API + better-auth)
apps/dashboard    React dashboard (Discord OAuth, config, stats, agent chat)
packages/shared   @10cordes/shared: Zod schemas, tool contracts, template engine
docs/             ROADMAP.md (backlog and decisions) · ARCHITECTURE.md (deep dive)
```

Dependency rule: `apps/bot → @10cordes/shared ← apps/dashboard`.

## Commands

```bash
pnpm dev          # build shared then spraxium dev (apps/bot)
pnpm build        # build every workspace
pnpm typecheck    # tsc --noEmit everywhere
pnpm test         # vitest (packages/shared + bot)
pnpm lint         # eslint flat config
pnpm --filter 10cordes-bot exec prisma migrate dev   # DB migrations (Prisma 6)
```

Production (apps/bot): `pnpm build` then `pnpm start` - never `node
dist/main.mjs` directly (the ConfigLoader reads `spraxium.config.js`).

## Architecture in one paragraph

Technical modules only: logging, ticket buttons, role menus, welcome
templates, moderation cases, and plumbing (database, audit, HTTP, components,
tool registry, module manager, health). All behavior lives in **skills**
(`apps/bot/src/modules/agent/skills.library.ts` + `agent_skills` table,
official library seeded per server at boot, member-created skills welcome) and
**automations** (`createAutomation`: Discord event -> actions, executed by
listeners with bot-permission gates). The agent's replies are plain text in
the request channel; a response cache deduplicates repeated questions; provider
failures (402 quota / 401 auth / 5xx) produce distinct, honest user notices.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - detailed plumbing
- [docs/ROADMAP.md](docs/ROADMAP.md) - backlog, platform verdicts, decisions
- [apps/bot/README.md](apps/bot/README.md) · [apps/dashboard/README.md](apps/dashboard/README.md)

## License

MIT
