import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import { ForbiddenError } from '@spraxium/http';
import { IntegrationViewSchema } from '@10cordes/shared';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildAccessGuard } from '../../auth/guards/guild-access.guard';
import { apiHarness, declaredRoutes, request } from './controller.test-support';
import { IntegrationsController } from './integrations.controller';

/**
 * Routes des intégrations de service, montées sur un vrai routeur Hono avec
 * le registre et l'exécuteur de gardes du framework (les deux gardes d'accès
 * sont des leurres qui en suivent le contrat). Le service est factice ; le
 * test d'accès, qui ferait une vraie requête, est remplacé. Ce que ces
 * épreuves fixent : les quatre routes exigent les deux gardes ; une réponse ne
 * montre jamais la clé ; une clé vide conserve le secret, `null` le retire ;
 * une adresse refusée (non https, locale, ou un nom qui résout en interne) est
 * refusée avant écriture, et la clé de l'instance ne part que chez l'instance.
 */

const KEY = 'test-key-not-real';
const NEW_KEY = 'test-key-not-real-either';
const GUILD = '1550000000000000001';
const USER = '1550000000000000002';
const BASE = `http://localhost/api/v1/guilds/${GUILD}`;

const guards = vi.hoisted(() => ({
  session: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
  guild: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
}));

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
const access = vi.hoisted(() => ({ test: vi.fn() }));

vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));

vi.mock('../../auth/guards/session.guard', () => ({
  SessionGuard: class {
    canActivate(ctx: Context): Promise<boolean> {
      return guards.session(ctx);
    }
  },
  sessionOf: async () => null,
}));

vi.mock('../../auth/guards/guild-access.guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/guards/guild-access.guard')>()),
  GuildAccessGuard: class {
    async canActivate(ctx: Context): Promise<boolean> {
      ctx.set('guildAccess', { guildId: ctx.req.param('guildId'), discordUserId: USER });
      if (!(await guards.guild(ctx))) throw new ForbiddenError('Accès refusé.');
      return true;
    }
  },
}));

vi.mock('./integrations.support', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./integrations.support')>()),
  testIntegrationAccess: (...args: unknown[]) => access.test(...args),
}));

interface State {
  enabled: boolean;
  origin: 'instance' | 'guild';
  apiKey: string | null;
  baseUrl: string | null;
  ownsKey: boolean;
}

function mount(initial: Partial<State> = {}) {
  const state: State = { enabled: true, origin: 'instance', apiKey: KEY, baseUrl: null, ownsKey: false, ...initial };
  const service = {
    resolve: vi.fn(async () => ({ slug: 'pixellab', enabled: state.enabled, origin: state.origin, config: { apiKey: state.apiKey ?? '', ...(state.baseUrl ? { baseUrl: state.baseUrl } : {}) } })),
    owned: vi.fn(async () => ({ hasApiKey: state.ownsKey, baseUrl: state.baseUrl })),
    upsert: vi.fn(async () => {
      if (state.apiKey === null) state.origin = 'guild';
    }),
    remove: vi.fn(async () => true),
  };
  const app = apiHarness(new Map()).serve(new IntegrationsController(service as never));
  return { app, service, state };
}

beforeEach(() => {
  guards.session.mockResolvedValue(true);
  guards.guild.mockResolvedValue(true);
  dns.lookup.mockResolvedValue([{ address: '104.18.1.2' }]);
  access.test.mockReset();
});

describe('IntegrationsController', () => {
  it('declare quatre routes, chacune sous la session puis l\u0027accès au serveur', () => {
    const routes = declaredRoutes(new IntegrationsController({} as never), [SessionGuard, GuildAccessGuard]);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /api/v1/guilds/:guildId/integrations',
      'PUT /api/v1/guilds/:guildId/integrations/:slug',
      'POST /api/v1/guilds/:guildId/integrations/:slug/test',
      'DELETE /api/v1/guilds/:guildId/integrations/:slug',
    ]);
    expect(routes.every((route) => route.guards)).toBe(true);
  });

  it('sans session ni droit : rien n\u0027est lu ni écrit', async () => {
    const { app, service } = mount();
    guards.session.mockResolvedValue(false);
    expect((await request(app, 'GET', `${BASE}/integrations`)).status).toBe(401);
    guards.session.mockResolvedValue(true);
    guards.guild.mockResolvedValue(false);
    expect((await request(app, 'GET', `${BASE}/integrations`)).status).toBe(403);
    expect(service.resolve).not.toHaveBeenCalled();
    expect(service.upsert).not.toHaveBeenCalled();
  });

  it('la liste ne montre que les services (jamais le fournisseur IA), sans la clé : sa présence et son indice', async () => {
    const { app } = mount();
    const reply = await request(app, 'GET', `${BASE}/integrations`);
    expect(reply.status).toBe(200);
    const views = IntegrationViewSchema.array().parse(reply.body?.integrations);
    expect(views.map((view) => view.slug)).toEqual(['pixellab']);
    expect(views[0]).toMatchObject({ source: 'instance', enabled: true, key: { hasApiKey: true, keyHint: '\u2022\u2022\u2022\u2022real' }, tools: expect.arrayContaining(['image.icon']) });
    expect(JSON.stringify(reply.body)).not.toContain(KEY);
  });

  it('mettre à jour avec une clé vide conserve le secret ; `null` la retire ; une clé saisie part nettoyée', async () => {
    const { app, service } = mount();
    const kept = await request(app, 'PUT', `${BASE}/integrations/pixellab`, { apiKey: '' });
    expect(kept.status).toBe(200);
    expect(service.upsert).toHaveBeenLastCalledWith(GUILD, 'pixellab', {}, USER, 'api');
    expect(kept.body?.integration).toMatchObject({ key: { hasApiKey: true } });

    const removed = await request(app, 'PUT', `${BASE}/integrations/pixellab`, { apiKey: null });
    expect(service.upsert).toHaveBeenLastCalledWith(GUILD, 'pixellab', { apiKey: null }, USER, 'api');
    expect(JSON.stringify(removed.body)).not.toContain(KEY);

    const replaced = await request(app, 'PUT', `${BASE}/integrations/pixellab`, { apiKey: `  ${NEW_KEY}  `, enabled: false });
    expect(service.upsert).toHaveBeenLastCalledWith(GUILD, 'pixellab', { enabled: false, apiKey: NEW_KEY }, USER, 'api');
    expect(JSON.stringify(replaced.body)).not.toContain(NEW_KEY);
  });

  it('une adresse non https, ou locale, est refusée avant écriture', async () => {
    const { app, service } = mount({ ownsKey: true });
    for (const baseUrl of ['http://api.exemple.test/v1', 'https://localhost/v1', 'https://127.0.0.1/v1', 'https://10.0.0.4/v1', 'https://api.exemple.test/v1?x=1', 'https://utilisateur:mdp@api.exemple.test/v1']) {
      const reply = await request(app, 'PUT', `${BASE}/integrations/pixellab`, { baseUrl });
      expect(reply.status, baseUrl).toBe(400);
      expect(reply.body?.details, baseUrl).toEqual([expect.objectContaining({ property: 'baseUrl' })]);
    }
    expect(service.upsert).not.toHaveBeenCalled();
  });

  it('un nom public qui résout vers une adresse privée est refusé', async () => {
    const { app, service } = mount({ ownsKey: true });
    dns.lookup.mockResolvedValue([{ address: '10.0.0.5' }]);
    const reply = await request(app, 'PUT', `${BASE}/integrations/pixellab`, { baseUrl: 'https://interne.exemple.test/v1' });
    expect(reply.status).toBe(400);
    expect(service.upsert).not.toHaveBeenCalled();
  });

  it('la clé de l\u0027instance ne part qu\u0027à l\u0027adresse de l\u0027instance : une adresse propre exige la clé propre du serveur', async () => {
    const { app, service } = mount({ ownsKey: false });
    const reply = await request(app, 'PUT', `${BASE}/integrations/pixellab`, { baseUrl: 'https://ailleurs.exemple.test/v1' });
    expect(reply.status).toBe(400);
    expect(reply.body?.details).toEqual([expect.objectContaining({ property: 'baseUrl' })]);
    expect(service.upsert).not.toHaveBeenCalled();
  });

  it('un fournisseur de modèles n\u0027est pas une intégration de service : 404, comme un slug inconnu', async () => {
    const { app, service } = mount();
    expect((await request(app, 'POST', `${BASE}/integrations/llm/test`)).status).toBe(404);
    expect((await request(app, 'PUT', `${BASE}/integrations/llm`, { enabled: false })).status).toBe(404);
    expect((await request(app, 'DELETE', `${BASE}/integrations/inconnu`)).status).toBe(404);
    expect(service.upsert).not.toHaveBeenCalled();
    expect(access.test).not.toHaveBeenCalled();
  });

  it('retirer le réglage du serveur : { removed: boolean }', async () => {
    const { app, service } = mount();
    expect(await request(app, 'DELETE', `${BASE}/integrations/pixellab`)).toEqual({ status: 200, body: { removed: true } });
    expect(service.remove).toHaveBeenCalledWith(GUILD, 'pixellab', USER, 'api');
  });

  it('le test d\u0027accès : sans clé ou désactivé, un constat (200) sans requête ; avec une clé, la clé déchiffrée ne fuit pas', async () => {
    access.test.mockResolvedValue({ ok: true, summary: 'Clé acceptée.', status: 200, ms: 8 });
    const { app } = mount();
    const reply = await request(app, 'POST', `${BASE}/integrations/pixellab/test`);
    expect(reply).toEqual({ status: 200, body: { ok: true, summary: 'Clé acceptée.', status: 200, ms: 8 } });
    expect(access.test).toHaveBeenCalledWith('pixellab', { apiKey: KEY, baseUrl: null });

    const keyless = mount({ apiKey: null });
    expect(await request(keyless.app, 'POST', `${BASE}/integrations/pixellab/test`)).toMatchObject({ status: 200, body: { ok: false, status: null, ms: 0 } });
    const off = mount({ enabled: false });
    expect(await request(off.app, 'POST', `${BASE}/integrations/pixellab/test`)).toMatchObject({ status: 200, body: { ok: false, status: null, ms: 0 } });
    expect(access.test).toHaveBeenCalledTimes(1);
  });
});
