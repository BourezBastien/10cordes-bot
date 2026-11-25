import { timingSafeEqual } from 'node:crypto';
import type { HttpGuard } from '@spraxium/http';
import type { Context } from 'hono';
import { getValidatedEnv } from '../env.accessor';

/**
 * Protège la sonde du processus (`/healthz`) par la clé API serveur à serveur
 * (en-tête `x-api-key`), quand `HTTP_API_KEY` est réglé ; sans clé réglée, la
 * sonde est ouverte. C'est la SEULE route qui demande cette clé : les routes
 * du dashboard s'authentifient par la session.
 */
export class ProbeKeyGuard implements HttpGuard {
  async canActivate(ctx: Context): Promise<boolean> {
    const expected = getValidatedEnv().HTTP_API_KEY;
    if (!expected) return true;
    const provided = ctx.req.header('x-api-key');
    if (!provided) return false;
    const given = Buffer.from(provided);
    const wanted = Buffer.from(expected);
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  }
}
