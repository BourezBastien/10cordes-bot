import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@prisma/client';
import type { AppEnv } from '../app.env';
import { getValidatedEnv } from './env.accessor';
import { trustedOriginsOf } from './auth-origins';

let instance: ReturnType<typeof createAuth> | undefined;

/** Les jetons que Discord rend à la connexion : le bot ne s'en sert pas, ils ne restent pas en base. */
const OAUTH_TOKEN_FIELDS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
} as const;

function createAuth(env: AppEnv) {
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const origins = trustedOriginsOf(env.DASHBOARD_ORIGIN);
  // L'adresse publique est celle du dashboard : après la connexion Discord, le
  // navigateur y est renvoyé (en dev comme quand le bot sert le panel).
  const publicUrl = origins[0] ?? `http://127.0.0.1:${env.PORT}`;

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: publicUrl,
    // Comparaison exacte, origine par origine : une liste grossière ouvrirait la porte à un faux voisin.
    trustedOrigins: origins,
    // Cookie de session marqué `Secure` dès que l'adresse publique est en https.
    advanced: { useSecureCookies: publicUrl.startsWith('https://') },
    database: prismaAdapter(prisma, { provider: 'sqlite' }),
    emailAndPassword: { enabled: false },
    socialProviders: {
      discord: {
        clientId: env.DISCORD_CLIENT_ID ?? '',
        clientSecret: env.DISCORD_CLIENT_SECRET ?? '',
        // Le strict nécessaire : l'identité. L'appartenance à un serveur se
        // vérifie avec le client du bot, jamais avec un jeton de l'utilisateur.
        scopes: ['identify'],
      },
    },
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: { enabled: true, window: 60, max: 20 },
    databaseHooks: {
      account: {
        create: { after: (account) => scrubOAuthTokens(prisma, account.id) },
        update: { after: (account) => scrubOAuthTokens(prisma, account.id) },
      },
    },
  });
}

/**
 * Efface les jetons OAuth de la ligne du compte lié ; le snowflake (`accountId`)
 * reste. La connexion attend cet effacement (une seule écriture) : un échec ne
 * l’empêche pas, mais il se dit, sans jamais un jeton.
 */
async function scrubOAuthTokens(prisma: PrismaClient, accountId: string): Promise<void> {
  try {
    await prisma.account.updateMany({ where: { id: accountId }, data: OAUTH_TOKEN_FIELDS });
  } catch {
    console.warn(`[Auth] jetons OAuth non effacés sur le compte lié ${accountId.slice(0, 24)} : vérifie la table account.`);
  }
}

/** True quand le login Discord est configurable (secret, identifiant et secret OAuth présents). */
export function isAuthConfigured(env: AppEnv): boolean {
  return Boolean(env.BETTER_AUTH_SECRET && env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
}

/**
 * Instance better-auth unique (lazy), connexion Discord uniquement. Utilise
 * son propre PrismaClient : elle est créée en dehors du graphe DI (guards et
 * middleware d'authentification). Lève une erreur si le login n'est pas
 * configuré : `isAuthConfigured` permet de le savoir avant.
 */
export function getAuth(env: AppEnv): ReturnType<typeof createAuth> {
  if (!isAuthConfigured(env)) {
    throw new Error('API auth requires BETTER_AUTH_SECRET, DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in the environment.');
  }
  instance ??= createAuth(env);
  return instance;
}

/** Ce qu'une session valide contient. */
export type AuthSession = NonNullable<Awaited<ReturnType<ReturnType<typeof createAuth>['api']['getSession']>>>;

/**
 * Session de la requête (cookie), ou null : pas de session valide, ou login
 * Discord non configuré. Une authentification absente ferme l'accès (401),
 * elle ne le rouvre pas.
 */
export async function readSession(headers: Headers): Promise<AuthSession | null> {
  const env = getValidatedEnv();
  if (!isAuthConfigured(env)) return null;
  return getAuth(env).api.getSession({ headers });
}
