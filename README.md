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

### Environment variables

| Key | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | **Yes** | - | Bot token (developer portal → Bot → Reset Token). |
| `DEEPSEEK_API_KEY` | For the agent | - | DeepSeek API key (the agent's LLM brain, OpenAI-compatible). |
| `DATABASE_URL` | No | `file:../data/bot.db` | SQLite database (Prisma 6; relative to `apps/bot/prisma`). |
| `PORT` | No | `3000` | REST API port. |
| `DASHBOARD_ORIGIN` | No | `http://localhost:5173` | Dashboard origin (CORS + OAuth redirect). |
| `BETTER_AUTH_SECRET` | For the dashboard | - | better-auth encryption secret (min 32 chars, `openssl rand -base64 32`). |
| `DISCORD_CLIENT_ID` | For the dashboard | - | OAuth2 application ID. |
| `DISCORD_CLIENT_SECRET` | For the dashboard | - | OAuth2 client secret (dashboard login). |
| `HTTP_API_KEY` | No | - | Optional server-to-server key (`x-api-key` header). |
| `PIXELLAB_API_KEY` | No | - | PixelLab key (pixel art icons and emojis). Also configurable live by the owner via a modal. |
| `KIE_API_KEY` | No | - | kie.ai key (Suno music generation + z-image generation). |
| `KIE_MODEL` | No | `V6_MINI` | Suno model (`V6_MINI`, `V6`, `V6_WILD`). |
| `DEEPSEEK_MODEL` | No | `deepseek-flash` | Model name served by the provider. |
| `DEEPSEEK_EFFORT` | No | `low` | Reasoning effort (`low` = fast replies). |
| `REDIS_URL` | No | `redis://127.0.0.1:6379` | Durable task queue; falls back to in-memory without it. |
| `DISCORD_BOT_NAME` | No | `10cordes` | Bot name recognized in plain text (no mention needed). |
| `DISCORD_BOT_ALIASES` | No | - | Extra nicknames recognized in plain text (comma-separated). |
| `E2E_ENABLED` | No | `false` | Master switch for the E2E test rigs (dev server only). |
| `E2E_STAFF_WEBHOOK_IDS` | No | - | Webhook IDs whose messages speak with staff permissions (test rig). |

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
templates, moderation cases, polls, giveaways, voice streaming, and plumbing
(database, audit, HTTP, components, tool registry, module manager, health).
All behavior lives in **skills** (`apps/bot/src/modules/agent/skills.library.ts`
+ `agent_skills` table, official library seeded per server at boot with
duplicate-guards, member-created skills welcome) and **automations**
(`createAutomation`: Discord event -> actions, executed by listeners with
bot-permission gates). The agent itself is a tool registry of 90+
permission-gated tools: every mutation archives a pre-state in the audit
log and a full server snapshot precedes the first structural tool of a
request, so anything can be rolled back (`getLastSnapshot`). Progress is
visible: a single in-place status line (`[THINKING]...` / `[TOOL] ...`)
tracks long builds and analyses. Replies are plain text in the request
channel; a response cache deduplicates repeated questions; provider failures
(402 quota / 401 auth / 5xx) produce distinct, honest user notices.

## Agent capabilities in production

**Create**

- **Music generation** (kie.ai / Suno V6_MINI, 12 credits per song, 90 s cap):
  topical lyrics are researched first (web + news, sources verified but not
  cited), lyrics calibrated to the duration, the MP3 is posted as a real
  attachment with its title - and nothing else.
- **Voice streaming** (@discordjs/voice, pure-JS stack: opusscript +
  libsodium + ffmpeg-static): `voice.join/play/skip/stop/leave/status`,
  queue of 20, SSRF-guarded URLs only.
- **Image generation**: free-form images via kie.ai / z-image (0.8 credit,
  ~6 s, ratio-aware) delivered as attachments; pixel art icons and emojis
  stay on PixelLab.

**Community**

- **Polls**: `createPoll` posts a button-per-option panel, one vote per
  member (changeable), auto-closes at the deadline (timer + boot sweep,
  restart-safe) and edits the message with results: counts, percentages,
  bars, winner, buttons removed.
- **Tickets**: the agent builds categories per type, validates them on the
  right guild, posts a panel (buttons or selector, each entry carries its
  category), and every opened ticket gets a Components V2 welcome embed with
  Claim / Close / Ask-for-help buttons (staff-gated, transcript on close).
- **Universal panels**: `sendPanel` builds any Components V2 embed on the
  fly (title, description, accent color, footer) with typed buttons -
  open a ticket, post a canned message, external link. Persisted: panel
  interactions survive restarts.

**Run the server**

- **Server analysis**: `analyzeActivity` measures real inactivity (bots and
  webhooks excluded, dates included) for archive campaigns; long analyses and
  builds are narrated live (`announceStep`) with per-item counters.
- **Guaranteed rollback**: destructive and structural actions archive their
  pre-state plus a full server snapshot (categories, channels, roles) in the
  audit log; `getLastSnapshot` feeds exact restorations.
- **Progressive context**: full analyses are memorized (`saveServerMemory`)
  so follow-up questions on the same topic answer instantly.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - detailed plumbing
- [docs/ROADMAP.md](docs/ROADMAP.md) - backlog, platform verdicts, decisions
- [apps/bot/README.md](apps/bot/README.md) · [apps/dashboard/README.md](apps/dashboard/README.md)

## License

MIT
