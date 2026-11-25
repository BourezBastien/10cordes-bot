import { Hono, type Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSession } from '../auth.instance';
import { SessionGuard, sessionOf } from './session.guard';

/**
 * Garde de session : elle échoue fermé (sans session, ou login Discord non
 * configuré, l'accès API est refusé), et pose la session dans le contexte
 * pour les handlers et les gardes en aval.
 */

vi.mock('../auth.instance', () => ({ readSession: vi.fn() }));

// Clé calculée : le scanner du registre des outils lit, dans toute source suivie, une clé name suivie d'une chaîne littérale.
const NAME = 'name';
const SESSION = { session: { id: 's1', userId: 'u1' }, user: { id: 'u1', [NAME]: 'Test' } } as Awaited<ReturnType<typeof readSession>>;

/** Fait passer une requête par la garde, dans un vrai contexte Hono, et rend ce que la garde a laissé. */
async function through(headers: Record<string, string>, run: (ctx: Context) => Promise<unknown>) {
  const app = new Hono();
  app.all('*', async (ctx) => ctx.json((await run(ctx)) as Record<string, unknown>));
  const response = await app.request('/api/v1/guilds/1550000000000000001/x', { headers });
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.mocked(readSession).mockReset();
});

describe('SessionGuard', () => {
  it('sans session : refus, et rien n\u0027est posé dans le contexte', async () => {
    vi.mocked(readSession).mockResolvedValue(null);
    const result = await through({ cookie: 'session=absente' }, async (ctx) => ({ allowed: await new SessionGuard().canActivate(ctx), session: ctx.get('session') ?? null }));
    expect(result).toEqual({ allowed: false, session: null });
    expect(readSession).toHaveBeenCalledTimes(1);
  });

  it('avec une session valide : accès, et la session est posée pour la suite', async () => {
    vi.mocked(readSession).mockResolvedValue(SESSION);
    const result = await through({ cookie: 'session=valide' }, async (ctx) => ({ allowed: await new SessionGuard().canActivate(ctx), session: ctx.get('session') }));
    expect(result).toMatchObject({ allowed: true, session: { user: { id: 'u1' } } });
  });

  it('une erreur de lecture (session illisible) échoue fermé : rien n\u0027est posé', async () => {
    vi.mocked(readSession).mockRejectedValue(new Error('base indisponible'));
    const set = vi.fn();
    const ctx = { req: { raw: { headers: new Headers() } }, set } as unknown as Context;
    await expect(new SessionGuard().canActivate(ctx)).rejects.toThrow('base indisponible');
    expect(set).not.toHaveBeenCalled();
  });
});

describe('sessionOf', () => {
  it('relit la session déjà posée par la garde, sans nouvelle lecture', async () => {
    vi.mocked(readSession).mockResolvedValue(SESSION);
    const result = await through({}, async (ctx) => {
      ctx.set('session', SESSION);
      const found = await sessionOf(ctx);
      return { found, reads: vi.mocked(readSession).mock.calls.length };
    });
    expect(result).toEqual({ found: SESSION, reads: 0 });
  });

  it('sans session posée : la lit, la pose, et la rend (ou null)', async () => {
    vi.mocked(readSession).mockResolvedValue(null);
    const none = await through({}, async (ctx) => ({ found: await sessionOf(ctx), stored: ctx.get('session') ?? null }));
    expect(none).toEqual({ found: null, stored: null });
    vi.mocked(readSession).mockResolvedValue(SESSION);
    const some = await through({}, async (ctx) => {
      const found = await sessionOf(ctx);
      return { found, stored: ctx.get('session') };
    });
    expect(some).toMatchObject({ found: { user: { id: 'u1' } }, stored: { user: { id: 'u1' } } });
  });
});
