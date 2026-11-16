import type { HttpGuard } from '@spraxium/http';
import type { Context } from 'hono';
import { getValidatedEnv } from '../env.accessor';
import { getAuth } from '../auth.instance';

/**
 * Exige une session better-auth valide (cookie). La session est stockée dans le
 * contexte Hono (`ctx.set('session', …)`) pour les handlers/guards en aval.
 * Échoue fermé : si l'auth n'est pas configurée, l'accès API est refusé (401).
 */
export class SessionGuard implements HttpGuard {
  async canActivate(ctx: Context): Promise<boolean> {
    const auth = getAuth(getValidatedEnv());
    const session = await auth.api.getSession({ headers: ctx.req.raw.headers });
    if (!session) return false;
    ctx.set('session', session);
    return true;
  }
}
