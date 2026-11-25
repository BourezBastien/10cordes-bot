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
# La CLI Prisma 7 lit l'adresse de la base dans prisma.config.ts, qui importe
# la règle d'adresse du projet et le chargement des fichiers d'environnement :
# les trois vont avec les migrations.
COPY --from=build /app/apps/bot/prisma.config.ts apps/bot/prisma.config.ts
COPY --from=build /app/apps/bot/src/modules/database/database-url.ts apps/bot/src/modules/database/database-url.ts
COPY --from=build /app/apps/bot/src/env-files.ts apps/bot/src/env-files.ts

EXPOSE 3000
WORKDIR /app/apps/bot

# Sonde du processus (HEALTHCHECK de l'image, lu par `docker ps` et les
# répartiteurs) : 200 quand tout va bien, 503 dès qu'un composant manque ou
# que l'extinction a commencé. Le démarrage complet prend environ une minute.
# La clé de la sonde (`HTTP_API_KEY`) vient de l'environnement du conteneur :
# rien d'elle n'est écrit ici.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz', { headers: process.env.HTTP_API_KEY ? { 'x-api-key': process.env.HTTP_API_KEY } : {} }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Applique les migrations puis lance le bot compilé (config découverte dans
# .spraxium/dist).
# R1e : le build produit main.mjs (pas .js) + le config .mjs doit être copié en .js.
# `exec` : node remplace le shell, c'est lui qui reçoit SIGTERM (`docker stop`)
# et s'éteint proprement (demandes en cours soldées dans le délai de grâce).
# Le délai de grâce du bot (SHUTDOWN_GRACE_MS, 20 s) doit rester inférieur au
# `stop_grace_period` de Docker (30 s dans le compose).
CMD ["sh", "-c", "cp -n .spraxium/dist/spraxium.config.mjs .spraxium/dist/spraxium.config.js 2>/dev/null; npx prisma migrate deploy && exec node .spraxium/dist/src/main.mjs"]
