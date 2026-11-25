import { HttpCtx, HttpController, HttpGet, HttpPost } from '@spraxium/http';
import type { Context } from 'hono';
import { AppEnv } from '../app.env';
import { PrismaService } from '../modules/database/prisma.service';
import { getAuth, isAuthConfigured } from './auth.instance';

/** Statut et message d’un mount better-auth absent : le login Discord n’est pas configuré. */
export const AUTH_UNCONFIGURED_STATUS = 503;
export const AUTH_UNCONFIGURED_MESSAGE =
  'Authentification non configurée : DISCORD_CLIENT_ID (identifiant OAuth Discord du bot) est absent de l\u0027environnement.';

/**
 * Monte les endpoints better-auth (`/api/auth/*`) : le handler better-auth est
 * un simple `(Request) => Response`, on renvoie la Response native, qui passe
 * telle quelle à travers le pipeline du framework.
 *
 * Sans login Discord configuré (secret, identifiant et secret OAuth), aucune
 * session ne peut s’ouvrir : chaque requête répond 503 avec la cause, plutôt
 * qu’une erreur de serveur journalisée à chaque chargement du dashboard.
 */
@HttpController('/api/auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: AppEnv,
  ) {}

  @HttpGet('/*')
  @HttpPost('/*')
  async handle(@HttpCtx() ctx: Context): Promise<Response> {
    if (!isAuthConfigured(this.env)) {
      return ctx.json({ ok: false, error: AUTH_UNCONFIGURED_MESSAGE }, AUTH_UNCONFIGURED_STATUS);
    }
    const auth = getAuth(this.env);
    return auth.handler(ctx.req.raw);
  }
}
