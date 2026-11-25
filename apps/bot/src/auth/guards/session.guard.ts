import type { HttpGuard } from '@spraxium/http';
import type { Context } from 'hono';
import { readSession } from '../auth.instance';

/**
 * Exige une session better-auth valide (cookie). La session est posée dans le
 * contexte Hono (`ctx.set('session', …)`) pour les handlers et les gardes en
 * aval. Échoue fermé : sans session, ou login Discord non configuré, l'accès
 * API est refusé (401).
 */
export class SessionGuard implements HttpGuard {
  async canActivate(ctx: Context): Promise<boolean> {
    const session = await readSession(ctx.req.raw.headers);
    if (!session) return false;
    ctx.set('session', session);
    return true;
  }
}

/** Session déjà lue par `SessionGuard`, sinon lue ici ; null sans session valide. */
export async function sessionOf(ctx: Context): Promise<Awaited<ReturnType<typeof readSession>>> {
  const existing = ctx.get('session') as Awaited<ReturnType<typeof readSession>> | undefined;
  if (existing) return existing;
  const session = await readSession(ctx.req.raw.headers);
  if (session) ctx.set('session', session);
  return session;
}
