# Contributing to 10cordes-bot

Thanks for helping build the most modular Discord bot out there. 🧩

## Getting started

```bash
pnpm install
cp apps/bot/.env.example apps/bot/.env    # DISCORD_TOKEN is required to run the bot
pnpm --filter 10cordes-bot exec prisma migrate dev
pnpm dev                                  # builds @10cordes/shared then starts spraxium dev
```

Useful scripts (root):

| Script | What it does |
|---|---|
| `pnpm lint` / `pnpm lint:fix` | ESLint (`@bluzzi/eslint-config`) |
| `pnpm typecheck` | `tsc --noEmit` in every workspace |
| `pnpm test` | Vitest suites (`packages/shared`) |
| `pnpm build` | Build all workspaces |

## Branch model (git-flow lite)

```
main      ← stable, tagged releases only
develop   ← integration branch
feature/* ← one branch per feature, branched from develop
fix/*     ← bugfixes
```

PRs target `develop`. Releases are cut from `main` with `vX.Y.Z` tags.

## Conventions

- **Conventional commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:` …).
- **Slash commands only** — never wire prefix commands.
- **Every feature is a module**: register it in `apps/bot/src/modules/module-manager/module.catalog.ts` (with `dependsOn` / `recommends` when relevant), otherwise it won't be toggleable.
- **Components V2 is the default rendering** — use `apps/bot/src/shared/ui` helpers (`panel`, `text`). No "v2" suffixes in names; it is the base rendering, not a variant.
- **No hardcoding**: user-facing strings will move to i18n; config lives in Zod schemas (`packages/shared`); durations parse via `parseDurationMs`.
- **Type-only imports** use `import type` (`isolatedModules` is on).
- **Guards are instantiated without DI** — services reachable from guards must expose a runtime accessor (see `getModuleManager()`).

## Pull request checklist

- [ ] `pnpm lint` clean
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green — add tests for any pure logic in `packages/shared`
- [ ] New user-facing strings flagged for i18n
- [ ] Module registered in the catalog + documented in `docs/ROADMAP.md` if it's a new feature

## Reporting bugs & suggesting features

Open an issue with: what you did, what happened, what you expected — and the module involved. Feature requests are triaged against [docs/ROADMAP.md](./docs/ROADMAP.md).
