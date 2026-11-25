import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { API_CSP, ApiPolicyMiddleware, PAGE_CSP } from './api-policy.middleware';

/**
 * Règles communes de l'API du dashboard, avant toute route : rien ne se met
 * en cache ni ne s'indexe ; toute requête de l'API v1 qui modifie vient d'une
 * origine autorisée (la session voyage dans un cookie : sans ce contrôle, une
 * page tierce ferait modifier le serveur par un membre connecté) ; chaque
 * réponse porte une CSP, celle des pages sur les seules pages HTML du bot.
 */

const TRUSTED = ['https://panel.exemple.test', 'http://localhost:5173'];

function app() {
  const reached = vi.fn();
  const hono = new Hono();
  hono.use('*', async (ctx, next) => new ApiPolicyMiddleware(() => TRUSTED).handle(ctx, next));
  hono.all('/page', (ctx) => ctx.html('<!doctype html><title>page</title>'));
  hono.all('/brute', () => new Response('<!doctype html><title>brute</title>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  hono.all('/api/accueil', (ctx) => ctx.html('<!doctype html><title>accueil</title>'));
  hono.all('/api/v1/brute', () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
  hono.all('/plantage', () => {
    throw new Error('plantage');
  });
  hono.onError((error, ctx) => ctx.json({ ok: false, error: error.message }, 500));
  hono.all('*', (ctx) => {
    reached(ctx.req.method, ctx.req.path);
    return ctx.text('servi');
  });
  return { hono, reached };
}

const send = (hono: Hono, method: string, path: string, headers: Record<string, string> = {}) => hono.request(path, { method, headers });

describe('ApiPolicyMiddleware', () => {
  it('toute réponse de l\u0027API n\u0027est ni mise en cache ni indexée, même rendue toute prête', async () => {
    const { hono } = app();
    const api = await send(hono, 'GET', '/api/v1/guilds/1550000000000000001/providers');
    expect(api.headers.get('cache-control')).toBe('no-store');
    expect(api.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const auth = await send(hono, 'GET', '/api/auth/get-session');
    expect(auth.headers.get('cache-control')).toBe('no-store');
    const brute = await send(hono, 'GET', '/api/v1/brute');
    expect(brute.headers.get('cache-control')).toBe('no-store');
    expect(brute.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const elsewhere = await send(hono, 'GET', '/healthz');
    expect(elsewhere.headers.get('cache-control')).toBeNull();
  });

  it('une lecture passe d\u0027où que vienne la requête', async () => {
    const { hono, reached } = app();
    expect((await send(hono, 'GET', '/api/v1/guilds/1550000000000000001/rules', { origin: 'https://malveillant.exemple.test' })).status).toBe(200);
    expect(reached).toHaveBeenCalledTimes(1);
  });

  it('une requête qui modifie vient d\u0027une origine autorisée, sinon 403 et la route n\u0027est pas atteinte', async () => {
    const { hono, reached } = app();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const refused = await send(hono, method, '/api/v1/guilds/1550000000000000001/rules', { origin: 'https://malveillant.exemple.test' });
      expect(refused.status, method).toBe(403);
      expect(await refused.json(), method).toEqual({ ok: false, error: 'Origine non autorisée pour cette requête.' });
    }
    expect(reached).not.toHaveBeenCalled();
    const untrusted: Record<string, string>[] = [{ origin: 'null' }, { referer: 'https://malveillant.exemple.test/page' }, { origin: 'null', referer: 'https://panel.exemple.test/page' }];
    for (const headers of [{}, ...untrusted]) {
      expect((await send(hono, 'POST', '/api/v1/guilds/1550000000000000001/webhooks', headers)).status, JSON.stringify(headers)).toBe(403);
    }
    expect(reached).not.toHaveBeenCalled();
  });

  it('une origine autorisée passe par Origin, ou par Referer ; une origine presque pareille ne passe pas', async () => {
    const { hono, reached } = app();
    expect((await send(hono, 'POST', '/api/v1/guilds/1550000000000000001/webhooks', { origin: 'https://panel.exemple.test' })).status).toBe(200);
    expect((await send(hono, 'POST', '/api/v1/guilds/1550000000000000001/webhooks', { referer: 'http://localhost:5173/guilds/1550000000000000001' })).status).toBe(200);
    expect((await send(hono, 'POST', '/api/v1/guilds/1550000000000000001/webhooks', { origin: 'https://panel.exemple.test.malveillant.exemple.test' })).status).toBe(403);
    expect((await send(hono, 'POST', '/api/v1/guilds/1550000000000000001/webhooks', { origin: 'http://panel.exemple.test' })).status).toBe(403);
    expect(reached).toHaveBeenCalledTimes(2);
  });

  it('le login (hors API v1) n\u0027est pas soumis au contrôle d\u0027origine du middleware', async () => {
    const { hono, reached } = app();
    expect((await send(hono, 'POST', '/api/auth/sign-out', { origin: 'https://malveillant.exemple.test' })).status).toBe(200);
    expect(reached).toHaveBeenCalledTimes(1);
  });

  it('chaque réponse porte une CSP : celle de l\u0027API, et celle des pages sur une page HTML du bot seulement', async () => {
    const { hono } = app();
    expect(API_CSP).toBe("default-src 'none'");
    expect(PAGE_CSP).toContain("script-src 'self'");
    expect(PAGE_CSP).toContain("frame-ancestors 'none'");
    expect(PAGE_CSP).toContain("img-src 'self' data: https://cdn.discordapp.com");
    // Une page HTML du bot, rendue par le contexte ou par une Response toute prête.
    for (const path of ['/page', '/brute']) {
      const response = await send(hono, 'GET', path);
      expect(response.headers.get('content-security-policy'), path).toBe(PAGE_CSP);
    }
    // Tout le reste porte la CSP de l'API : une réponse d'une autre nature, une erreur, un refus.
    const others: [string, Response][] = [
      ['texte', await send(hono, 'GET', '/autre')],
      ['erreur', await send(hono, 'GET', '/plantage')],
      ['refus', await send(hono, 'POST', '/api/v1/guilds/1550000000000000001/rules', { origin: 'https://malveillant.exemple.test' })],
    ];
    for (const [label, response] of others) expect(response.headers.get('content-security-policy'), label).toBe(API_CSP);
    // Sous l'API, une page HTML reste soumise à la CSP de l'API : rien n'y charge de script.
    expect((await send(hono, 'GET', '/api/accueil')).headers.get('content-security-policy')).toBe(API_CSP);
  });
});
