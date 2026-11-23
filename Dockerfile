# ── Build stage ──────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/bot/package.json apps/bot/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @10cordes/shared build \
 && cd apps/bot && npx prisma generate && pnpm spraxium build

# ── Runtime stage ────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/bot/package.json apps/bot/package.json
COPY --from=build /app/apps/bot/.spraxium/dist apps/bot/.spraxium/dist
COPY --from=build /app/apps/bot/prisma apps/bot/prisma

EXPOSE 3000
WORKDIR /app/apps/bot

# Apply migrations then start the compiled bot (config discovered in .spraxium/dist).
# R1e : le build produit main.mjs (pas .js) + le config .mjs doit être copié en .js.
CMD ["sh", "-c", "cp -n .spraxium/dist/spraxium.config.mjs .spraxium/dist/spraxium.config.js 2>/dev/null; npx prisma migrate deploy --schema prisma/schema.prisma && node .spraxium/dist/src/main.mjs"]
