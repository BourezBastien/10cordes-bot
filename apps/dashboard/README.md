# 10cordes · dashboard (planned)

Web dashboard for the 10cordes-bot, served at [bot.10codes.io].

## Planned stack

- React 19 + TypeScript + Vite
- Tailwind CSS v4 (dark Tenkai-inspired theme: dark surfaces, small radii, no shadows)
- shadcn/ui patterns + Aceternity accents
- ApexCharts for stats
- better-auth client (Discord OAuth) talking to the bot's `/api/auth/*`
- REST client for `/api/v1/*` (session-guarded: guilds, modules, config)

## Status

Not scaffolded yet - tracked in docs/ROADMAP.md. The bot already exposes:

- `/api/auth/*` (better-auth, Discord social login, session cookies)
- `/api/v1/guilds/:id` (config read/write, module toggles, guarded by session
  + per-guild access checks)

When scaffolded, add `apps/dashboard` to the pnpm workspace (already covered by
`apps/*`) and proxy `/api` to the bot port (`127.0.0.1:3000`) in development.
