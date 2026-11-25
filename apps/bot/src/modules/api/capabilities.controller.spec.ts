import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import { ForbiddenError } from '@spraxium/http';
import { CapabilityRouteViewSchema } from '@10cordes/shared';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildAccessGuard } from '../../auth/guards/guild-access.guard';
import type { ResolvedRoute, RouteInput } from '../providers/provider-store.service';
import type { ProviderConfig } from '../providers/provider.types';
import { apiHarness, declaredRoutes, request } from './controller.test-support';
import { CapabilitiesController } from './capabilities.controller';

/**
 * Routes de capacités d'un serveur, montées sur un vrai routeur Hono avec
 * le registre et l'exécuteur de gardes du framework (les deux gardes
 * d'accès sont des leurres qui en suivent le contrat). Ce que ces épreuves
 * fixent : les trois routes exigent les deux gardes ; la vue est celle du
 * contrat, avec le slug du fournisseur ; une capacité mal formée est refusée
 * avant toute écriture ; délier une capacité sans route répond 404.
 */

const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';
const USER = '1550000000000000002';
const BASE = `http://localhost/api/v1/guilds/${GUILD}`;

const guards = vi.hoisted(() => ({
  session: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
  guild: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
}));

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

const provider: ProviderConfig = {
  id: 'provider-1',
  guildId: GUILD,
  slug: 'openrouter',
  displayName: 'OpenRouter',
  protocol: 'openai-chat',
  baseUrl: 'https://openrouter.ai/api/v1',
  authType: 'bearer',
  authHeaderName: null,
  apiKey: KEY,
  customHeaders: {},
  extraConfig: {},
  models: [],
  enabled: true,
};

const ROUTES: ResolvedRoute[] = [
  { capability: 'chat.default', provider, modelId: 'modèle-a', fallback: null, params: {} },
  { capability: 'custom.traduction', provider, modelId: 'modèle-b', fallback: { provider, modelId: 'modèle-a' }, params: { temperature: 0.2 } },
];

function mount() {
  const store = {
    routes: vi.fn(async () => ROUTES),
    slugIndex: vi.fn(async () => [{ id: 'provider-1', slug: 'openrouter' }]),
    bindRoute: vi.fn(async (_guildId: string, _capability: string, _input: RouteInput, _actorId: string, _origin: string) => ({ followedBy: ['chat.reasoning'] })),
    removeRoute: vi.fn(async () => true),
  };
  const app = apiHarness(new Map()).serve(new CapabilitiesController(store as never));
  return { app, store };
}

beforeEach(() => {
  guards.session.mockResolvedValue(true);
  guards.guild.mockResolvedValue(true);
});

describe('CapabilitiesController', () => {
  it('declare trois routes, chacune sous la session puis l\u0027accès au serveur', () => {
    const routes = declaredRoutes(new CapabilitiesController({} as never), [SessionGuard, GuildAccessGuard]);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /api/v1/guilds/:guildId/capabilities',
      'PUT /api/v1/guilds/:guildId/capabilities/:capability',
      'DELETE /api/v1/guilds/:guildId/capabilities/:capability',
    ]);
    expect(routes.every((route) => route.guards)).toBe(true);
  });

  it('sans session ni droit : rien n\u0027est lu', async () => {
    const { app, store } = mount();
    guards.session.mockResolvedValue(false);
    expect((await request(app, 'GET', `${BASE}/capabilities`)).status).toBe(401);
    guards.session.mockResolvedValue(true);
    guards.guild.mockResolvedValue(false);
    expect((await request(app, 'GET', `${BASE}/capabilities`)).status).toBe(403);
    expect(store.routes).not.toHaveBeenCalled();
  });

  it('la liste est celle du contrat : les neuf capacités natives dans l\u0027ordre (liées ou non), puis les capacités custom', async () => {
    const { app } = mount();
    const reply = await request(app, 'GET', `${BASE}/capabilities`);
    expect(reply.status).toBe(200);
    const routes = CapabilityRouteViewSchema.array().parse(reply.body?.routes);
    expect(routes.map((route) => route.capability)).toEqual([
      'chat.default',
      'chat.reasoning',
      'chat.ingestion',
      'image.generate',
      'image.edit',
      'music.generate',
      'tts.speak',
      'video.generate',
      'web.search',
      'custom.traduction',
    ]);
    expect(routes[0]).toMatchObject({ main: { providerId: 'provider-1', providerSlug: 'openrouter', modelId: 'modèle-a' }, fallback: null });
    expect(routes[1]).toMatchObject({ main: null, fallback: null });
    expect(routes[9]).toMatchObject({ fallback: { providerSlug: 'openrouter', modelId: 'modèle-a' }, params: { temperature: 0.2 } });
    expect(JSON.stringify(reply.body)).not.toContain(KEY);
  });

  it('lier : le corps validé part au store avec l\u0027utilisateur Discord de la session, la réponse rend les routes et celles qui ont suivi', async () => {
    const { app, store } = mount();
    const reply = await request(app, 'PUT', `${BASE}/capabilities/image.generate`, { providerId: 'provider-1', modelId: 'modèle-b', fallbackProviderId: 'provider-1', fallbackModelId: 'modèle-a' });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ followedBy: ['chat.reasoning'] });
    expect(CapabilityRouteViewSchema.array().safeParse(reply.body?.routes).success).toBe(true);
    expect(store.bindRoute).toHaveBeenCalledWith(GUILD, 'image.generate', { providerId: 'provider-1', modelId: 'modèle-b', fallbackProviderId: 'provider-1', fallbackModelId: 'modèle-a' }, USER, 'api');
  });

  it('une capacité mal formée, ou un corps incomplet : 400 avec le champ en cause, rien n\u0027est écrit', async () => {
    const { app, store } = mount();
    const path = await request(app, 'PUT', `${BASE}/capabilities/chat`, { providerId: 'provider-1', modelId: 'x' });
    expect(path.status).toBe(400);
    expect(path.body?.details).toEqual([expect.objectContaining({ property: 'capability' })]);
    const body = await request(app, 'PUT', `${BASE}/capabilities/chat.default`, { providerId: 'provider-1' });
    expect(body.status).toBe(400);
    expect(body.body?.details).toEqual([expect.objectContaining({ property: 'modelId' })]);
    expect(store.bindRoute).not.toHaveBeenCalled();
  });

  it('délier : les routes reviennent ; sans route : 404 ; capacité mal formée : 400', async () => {
    const { app, store } = mount();
    const reply = await request(app, 'DELETE', `${BASE}/capabilities/chat.default`);
    expect(reply.status).toBe(200);
    expect(Array.isArray(reply.body?.routes)).toBe(true);
    expect(store.removeRoute).toHaveBeenCalledWith(GUILD, 'chat.default', USER, 'api');
    store.removeRoute.mockResolvedValueOnce(false);
    expect((await request(app, 'DELETE', `${BASE}/capabilities/tts.speak`)).status).toBe(404);
    expect((await request(app, 'DELETE', `${BASE}/capabilities/contre-façon`)).status).toBe(400);
  });
});
