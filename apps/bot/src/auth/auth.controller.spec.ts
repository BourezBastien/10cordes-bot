import { Hono, type Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declaredRoutes } from '../modules/api/controller.test-support';
import { AUTH_UNCONFIGURED_MESSAGE, AUTH_UNCONFIGURED_STATUS, AuthController } from './auth.controller';

/**
 * Mount de better-auth. Configuré, chaque requête passe au handler de la
 * bibliothèque, avec la requête native ; sans login Discord configuré, chaque
 * requête répond un refus explicite (503) : aucune session ne peut s’ouvrir.
 */

const auth = vi.hoisted(() => ({ configured: vi.fn<(env: unknown) => boolean>(), get: vi.fn<(env: unknown) => { handler: ReturnType<typeof vi.fn> }>() }));

vi.mock('./auth.instance', () => ({
  isAuthConfigured: (env: unknown) => auth.configured(env),
  getAuth: (env: unknown) => auth.get(env),
}));

// Valeurs factices, sans valeur utilisable.
const ENV = { BETTER_AUTH_SECRET: 'test-secret-not-real-000000000000000000', DISCORD_CLIENT_ID: 'id', DISCORD_CLIENT_SECRET: 'test-secret-not-real' };

function app() {
  const hono = new Hono();
  const controller = new AuthController({} as never, ENV as never);
  hono.on(['GET', 'POST'], ['/api/auth/*'], async (ctx: Context) => controller.handle(ctx));
  return hono;
}

async function call(method: 'GET' | 'POST', path: string): Promise<{ status: number; text: string }> {
  const response = await app().request(`http://localhost${path}`, { method, headers: { cookie: 'session=x' } });
  return { status: response.status, text: await response.text() };
}

beforeEach(() => {
  auth.configured.mockReset();
  auth.get.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthController', () => {
  it('déclare son mount sous son préfixe, en lecture et en écriture, sans garde', () => {
    // Les décorateurs s'appliquent de bas en haut : l'écriture est enregistrée avant la lecture.
    expect(declaredRoutes(new AuthController({} as never, ENV as never), [])).toEqual([
      { method: 'POST', path: '/api/auth/*', handler: 'handle', guards: true },
      { method: 'GET', path: '/api/auth/*', handler: 'handle', guards: true },
    ]);
  });

  it('sans login Discord configuré : 503 avec la cause, en lecture comme en écriture, et better-auth n’est pas sollicité', async () => {
    auth.configured.mockReturnValue(false);
    for (const [method, path] of [['GET', '/api/auth/get-session'], ['POST', '/api/auth/sign-in/social']] as const) {
      const result = await call(method, path);
      expect(result.status, path).toBe(AUTH_UNCONFIGURED_STATUS);
      expect(JSON.parse(result.text), path).toEqual({ ok: false, error: AUTH_UNCONFIGURED_MESSAGE });
    }
    expect(AUTH_UNCONFIGURED_MESSAGE).toContain('DISCORD_CLIENT_ID');
    expect(auth.configured).toHaveBeenCalledWith(ENV);
    expect(auth.get).not.toHaveBeenCalled();
  });

  it('configuré : la requête native passe au handler better-auth, et sa réponse ressort telle quelle', async () => {
    auth.configured.mockReturnValue(true);
    const handler = vi.fn(async (_request: Request) => new Response('{"user":{"id":"u1"}}', { status: 200, headers: { 'content-type': 'application/json' } }));
    auth.get.mockReturnValue({ handler });
    const result = await call('GET', '/api/auth/get-session');
    expect(result.status).toBe(200);
    expect(result.text).toBe('{"user":{"id":"u1"}}');
    expect(handler).toHaveBeenCalledTimes(1);
    const passed = handler.mock.calls[0]?.[0] as Request;
    expect(passed.url).toBe('http://localhost/api/auth/get-session');
    expect(passed.headers.get('cookie')).toBe('session=x');
    expect(auth.get).toHaveBeenCalledWith(ENV);
  });
});
