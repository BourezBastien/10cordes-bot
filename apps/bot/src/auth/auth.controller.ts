import { HttpCtx, HttpController, HttpGet, HttpPost } from '@spraxium/http';
import type { Context } from 'hono';
import { AppEnv } from '../app.env';
import { PrismaService } from '../modules/database/prisma.service';
import { getAuth } from './auth.instance';

/**
 * Monte les endpoints better-auth (`/api/auth/*`) : le handler better-auth est un
 * simple `(Request) => Response` — on renvoie la Response native, qui passe
 * telle quelle à travers le pipeline du framework.
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
    const auth = getAuth(this.env);
    return auth.handler(ctx.req.raw);
  }
}
