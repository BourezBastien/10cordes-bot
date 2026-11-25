import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSE_PING_INTERVAL_MS } from '@10cordes/shared';
import type { AuditEntry } from '../audit/audit.service';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildAccessGuard } from '../../auth/guards/guild-access.guard';
import { DashboardEventsService } from './dashboard-events.service';
import { EventsController } from './events.controller';
import { API_CSP, ApiPolicyMiddleware, PAGE_CSP } from './api-policy.middleware';
import { declaredRoutes } from './controller.test-support';
import { PanelController } from './panel.controller';

/** Flux temps réel et service du panel : deux routes qui rendent autre chose que du JSON. */

const GUILD = '1550000000000000001';
const OTHER = '1550000000000000008';

/** Laisse le temps d'un tour d'événements, en temps réel (setTimeout n'est pas simulé ici). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

/** Bus réel, branché sur un audit factice dont le test pousse les entrées. */
function bus() {
  let listener: ((entry: AuditEntry) => void) | null = null;
  const onRecord = (received: (entry: AuditEntry) => void) => {
    listener = received;
    return () => undefined;
  };
  const service = new DashboardEventsService({ onRecord } as never);
  service.onBoot();
  const emit = (action: string, guildId: string): void => listener?.({ action, guildId, metadata: { apiKey: 'jamais' } } as AuditEntry);
  return { service, emit };
}

describe('EventsController', () => {
  it('déclare le flux d\u0027UN serveur, sous la session puis l\u0027accès au serveur', () => {
    const routes = declaredRoutes(new EventsController({} as never), [SessionGuard, GuildAccessGuard]);
    expect(routes).toEqual([{ method: 'GET', path: '/api/v1/guilds/:guildId/events', handler: 'events', guards: true }]);
  });

  it('le flux s\u0027ouvre, reçoit les événements typés de SON serveur, se lit sans cache, et se ferme', async () => {
    // Seuls les intervalles sont simulés : le signe de vie a le rythme du contrat (25 s), le reste du test reste en temps réel.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const { service, emit } = bus();
      const app = new Hono<{ Variables: { guildAccess: { guildId: string } } }>();
      app.get('/api/v1/guilds/:guildId/events', async (ctx) => {
        ctx.set('guildAccess', { guildId: ctx.req.param('guildId') });
        return new EventsController(service).events(ctx);
      });
      const abort = new AbortController();
      const response = await app.request(`http://localhost/api/v1/guilds/${GUILD}/events`, { signal: abort.signal });
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(response.headers.get('x-accel-buffering')).toBe('no');
      // L'abonnement suit la mise en file de l'ouverture, elle-même asynchrone.
      await settle();
      expect(service.subscriberCount(GUILD)).toBe(1);

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      const decoder = new TextDecoder();
      // Une seule lecture en attente à la fois : la suivante ne part qu'une fois la précédente servie.
      let inflight = reader!.read();
      const next = async (): Promise<string> => {
        const chunk = await inflight;
        inflight = reader!.read();
        return decoder.decode(chunk.value);
      };
      expect(await next()).toContain('event: open');

      emit('provider.upserted', GUILD);
      const pushed = await next();
      expect(pushed).toContain('event: provider.updated');
      expect(pushed).toContain('data: {"type":"provider.updated"}');
      // L'événement ne dit que son type : rien de l'entrée d'audit ne passe.
      expect(pushed).not.toContain('provider.upserted');
      expect(pushed).not.toContain('jamais');
      expect(pushed).not.toContain(GUILD);

      // L'activité d'un autre serveur n'y paraît jamais.
      emit('rules.updated', OTHER);
      const quiet = await Promise.race([inflight.then(() => 'reçu'), new Promise((resolve) => setTimeout(() => resolve('silence'), 50))]);
      expect(quiet).toBe('silence');

      // Signal de vie, au rythme du contrat.
      await vi.advanceTimersByTimeAsync(SSE_PING_INTERVAL_MS);
      expect(await next()).toContain('event: ping');

      // Le client part : sa lecture du corps est annulée, comme le fait le serveur HTTP quand la socket se ferme.
      abort.abort();
      await reader?.cancel();
      await settle();
      expect(service.subscriberCount(GUILD)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('à l\u0027extinction, le flux se ferme de lui-même : le corps se termine, l\u0027abonnement se retire', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const { service } = bus();
      const app = new Hono<{ Variables: { guildAccess: { guildId: string } } }>();
      app.get('/api/v1/guilds/:guildId/events', async (ctx) => {
        ctx.set('guildAccess', { guildId: ctx.req.param('guildId') });
        return new EventsController(service).events(ctx);
      });
      const response = await app.request(`http://localhost/api/v1/guilds/${GUILD}/events`);
      await settle();
      expect(service.subscriberCount(GUILD)).toBe(1);

      // Sans cela, un flux ne finit jamais seul : le serveur HTTP attendrait sa réponse indéfiniment.
      expect(service.closeAll()).toBe(1);

      const text = await new Response(response.body).text();
      expect(text).toContain('event: open');
      await settle();
      expect(service.subscriberCount(GUILD)).toBe(0);
      expect(await service.whenStreamsClose()).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PanelController', () => {
  const dirs: string[] = [];

  function dist(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), '10cordes-panel-'));
    dirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
      const slash = name.lastIndexOf('/');
      if (slash >= 0) mkdirSync(join(dir, name.slice(0, slash)), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    return dir;
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** Le panel monté comme en production : derrière le middleware de politique, qui a le dernier mot sur la CSP. */
  function serve(dir: string | null) {
    const hono = new Hono();
    hono.use('*', async (ctx, next) => new ApiPolicyMiddleware(() => []).handle(ctx, next));
    const controller = new PanelController({ DASHBOARD_DIST_DIR: dir ?? undefined } as never);
    hono.get('*', async (ctx) => controller.serve(ctx));
    hono.onError((error, ctx) => ctx.text(error.message, (error as { statusCode?: 400 | 404 }).statusCode ?? 500));
    return hono;
  }

  it('sa route fourre-tout est publique : aucune garde (les pages ne demandent pas de session)', () => {
    expect(declaredRoutes(new PanelController({} as never), [])).toEqual([{ method: 'GET', path: '/*', handler: 'serve', guards: true }]);
  });

  it('sans réglage, rien n\u0027est servi', async () => {
    expect((await serve(null).request('/')).status).toBe(404);
  });

  it('la racine et toute adresse du routeur rendent la page, avec la CSP des pages, sans cache', async () => {
    const hono = serve(dist({ 'index.html': '<!doctype html><title>10cordes</title>' }));
    for (const path of ['/', '/guilds', '/guilds/1550000000000000001/providers']) {
      const response = await hono.request(path);
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).toContain('10cordes');
      expect(response.headers.get('content-type'), path).toContain('text/html');
      expect(response.headers.get('content-security-policy'), path).toBe(PAGE_CSP);
      expect(response.headers.get('cache-control'), path).toBe('no-cache');
      expect(response.headers.get('x-robots-tag'), path).toBe('noindex, nofollow');
      expect(response.headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(response.headers.get('referrer-policy'), path).toBe('no-referrer');
    }
  });

  it('un fichier existant est servi avec son type ; ceux de /assets se cachent un an', async () => {
    const hono = serve(dist({ 'index.html': '<html></html>', 'assets/app.abc123.js': 'console.log(1)', 'assets/police.woff2': 'font', 'favicon.svg': '<svg/>' }));
    const asset = await hono.request('/assets/app.abc123.js');
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    // Seule la page HTML porte la CSP des pages ; une ressource garde celle de l'API.
    expect(asset.headers.get('content-security-policy')).toBe(API_CSP);
    expect((await hono.request('/')).headers.get('content-security-policy')).toBe(PAGE_CSP);
    expect((await hono.request('/favicon.svg')).headers.get('content-security-policy')).toBe(API_CSP);
    expect((await hono.request('/assets/police.woff2')).headers.get('content-type')).toBe('font/woff2');
    const icon = await hono.request('/favicon.svg');
    expect(icon.headers.get('content-type')).toBe('image/svg+xml');
    expect(icon.headers.get('cache-control')).toBe('no-cache');
  });

  it('une remontée de dossier ne sort jamais du dossier du panel', async () => {
    const hono = serve(dist({ 'index.html': '<html></html>' }));
    for (const path of ['/..%2F..%2Fpackage.json', '/assets/..%2F..%2Fpackage.json', '/%2e%2e/%2e%2e/etc/passwd', '/..%5C..%5Cpackage.json', '/%E0%A4%A']) {
      const response = await hono.request(`http://localhost${path}`);
      // Soit la page du routeur (une adresse illisible), soit 404 : jamais un fichier hors du dossier.
      expect([200, 404], path).toContain(response.status);
      if (response.status === 200) expect(await response.text(), path).toContain('<html></html>');
    }
    expect((await hono.request('/assets/absent.js')).status).toBe(404);
  });

  it('l\u0027API et la sonde ne sont jamais servies par le panel', async () => {
    const hono = serve(dist({ 'index.html': '<html></html>' }));
    expect((await hono.request('/api')).status).toBe(404);
    expect((await hono.request('/api/v1/guilds/1550000000000000001/providers')).status).toBe(404);
    expect((await hono.request('/healthz')).status).toBe(404);
    // Sans le panel non plus, un chemin inconnu rend le 404 JSON, sous la CSP de l'API.
    const missing = await serve(null).request('/guilds');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-security-policy')).toBe(API_CSP);
  });
});
