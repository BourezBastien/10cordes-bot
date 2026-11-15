import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@prisma/client';
import type { AppEnv } from '../app.env';

let instance: ReturnType<typeof createAuth> | undefined;

function createAuth(env: AppEnv) {
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: `http://127.0.0.1:${env.PORT}`,
    trustedOrigins: [env.DASHBOARD_ORIGIN],
    database: prismaAdapter(prisma, { provider: 'sqlite' }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      discord: {
        clientId: process.env.DISCORD_CLIENT_ID ?? '',
        clientSecret: env.DISCORD_CLIENT_SECRET,
        scopes: ['identify', 'email', 'guilds'],
      },
    },
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: { enabled: true, window: 60, max: 20 },
  });
}

/**
 * Instance better-auth unique (lazy) — connexion Discord uniquement
 * (email/password désactivé). Utilise son propre PrismaClient car elle est
 * créée en dehors du graphe DI (guards/middleware d'authentification).
 */
export function getAuth(env: AppEnv): ReturnType<typeof createAuth> {
  if (!env.BETTER_AUTH_SECRET || !env.DISCORD_CLIENT_SECRET) {
    throw new Error('API auth requires BETTER_AUTH_SECRET and DISCORD_CLIENT_SECRET in the environment.');
  }
  instance ??= createAuth(env);
  return instance;
}
