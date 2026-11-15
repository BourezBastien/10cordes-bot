import type { HttpGuard } from '@spraxium/http';
import type { Context } from 'hono';
import { AppEnv } from '../../app.env';
import { PrismaService } from '../../modules/database/prisma.service';
import { getAuth } from '../auth.instance';

/**
 * Exige une session better-auth valide (cookie). La session est stockée dans le
 * contexte Hono (`ctx.set('session', …)`) pour les handlers/guards en aval.
 * Échoue fermé : si l'auth n'est pas configurée, l'accès API est refusé (401).
 */
export class SessionGuard implements HttpGuard {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: AppEnv,
  ) {}

  async canActivate(ctx: Context): Promise<boolean> {
    const auth = getAuth(this.env);
    const session = await auth.api.getSession({ headers: ctx.req.raw.headers });
    if (!session) return false;
    ctx.set('session', session);
    return true;
  }
}
