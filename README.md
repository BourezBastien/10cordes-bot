<div align="center">

# 10cordes-bot

**The modular, agentic Discord bot - every feature is a module, every module is a command away.**

Built on [Spraxium](https://github.com/spraxium/spraxium) (discord.js v14) · TypeScript · Prisma · Fully typed

[![CI](https://img.shields.io/badge/CI-private-lightgrey)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933)](./package.json)
[![discord.js](https://img.shields.io/badge/discord.js-14-5865f2)](https://discord.js.org)
[![pnpm](https://img.shields.io/badge/pnpm-monorepo-F6921E)](./pnpm-workspace.yaml)

</div>

---

> ⚠️ **This repository is private during active development.** Public release comes later - the structure (releases, CI, contributing) is already production-grade.

## ✨ Highlights

- 🧩 **Everything is a module** - enable/disable any feature live, globally **and per server**, with a **dependency graph**: disabling `economy` cleanly cascades to `shop`, unless `shop` is required by another active module.
- 🛡️ **Per-module governance** - channel whitelists, required roles, per-user cooldowns, **mod quotas by role** (e.g. *3 mutes/hour max for moderators*), admin bypass - all configurable from Discord, no restart.
- 🌍 **Language follows the user** - every user picks their own language (`/language`); auto-detected from their Discord client on first interaction. Never imposed by the server.
- 📦 **One typed config per guild** - a single Zod-validated JSON document (`packages/shared`), editable via `/config` or transferable between servers (`/config export` / `/config import`).
- 💬 **Native Components V2 rendering** - every reply is a bordered container with text sections; embeds are the exception, not the rule.
- ⚡ **Live-edit everything** - every write goes through the same service layer used by slash commands: instant effect, persisted, cache-invalidated.
- 🔐 **Safety-first agentic admin (roadmap)** - plan → human confirmation → execute, **archive by default** (never hard-delete), destructive actions restricted to owner + ID whitelist.

## 🧰 Commands (P0 foundation)

| Command | Description |
|---|---|
| `/modules list` | Global + per-server module states |
| `/modules enable\|disable <module> [scope]` | Toggle with dependency cascade confirmation |
| `/modules configure <module> …` | Whitelists, required role, cooldown, role quotas, admin bypass |
| `/config view\|set\|export\|import` | Typed guild configuration, transferable |
| `/language set\|view\|reset` | Per-user language |
| `/ping` | Latency check (a module like any other) |

## 🚀 Quickstart

**Requirements:** Node 22+ (or 24/26), pnpm 12, a Discord application token.

```bash
pnpm install
cp apps/bot/.env.example apps/bot/.env     # set DISCORD_TOKEN (+ DATABASE_URL optional)
pnpm --filter 10cordes-bot exec prisma migrate dev
pnpm dev                                    # shared package builds, then spraxium dev
```

**Docker**

```bash
docker compose up -d
```

## 🗂 Project structure

```
apps/bot          Spraxium bot + REST API (Hono) + better-auth (dashboard phase)
packages/shared   Zod schemas, dependency-graph engine, template engine (bot + dashboard)
docs/             ROADMAP (feature backlog) · ARCHITECTURE (deep dive)
```

Full architecture: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) · Feature backlog: [docs/ROADMAP.md](./docs/ROADMAP.md)

## 🧩 Adding a module

1. Scaffold `apps/bot/src/modules/<feature>/` - `commands/`, `handlers/`, `<feature>.module.ts`
2. Register in the catalog: `module.catalog.ts` (`id`, `label`, `commands`, `dependsOn`, `recommends`)
3. Add its Zod schema + tools in `packages/shared` if it exposes new config or agent tools
4. Import the module in `apps/bot/src/app.module.ts` - done, it is toggleable like the rest

## 🗺 Roadmap

See [docs/ROADMAP.md](./docs/ROADMAP.md) - enriched from 200+ validated community suggestions: welcome cards, logging, moderation with case system, reaction roles, leveling, tickets, **agentic Discord administration** (plan → confirm → execute), realtime games, multi-provider AI (OpenRouter/OpenAI/Gemini/Ollama), and more.

## 🤝 Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md). Branch model: `main` (stable) ← `develop` (integration) ← `feature/*`. Conventional commits.

## 📄 License

[MIT](./LICENSE)
