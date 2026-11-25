import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import { ForbiddenError } from '@spraxium/http';
import { ProviderViewSchema } from '@10cordes/shared';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildAccessGuard } from '../../auth/guards/guild-access.guard';
import { ProviderHealthService } from '../providers/provider-health.service';
import type { ProviderInput } from '../providers/provider-store.service';
import type { ProviderConfig, ProviderModel } from '../providers/provider.types';
import { apiHarness, declaredRoutes, request } from './controller.test-support';
import { ProvidersController } from './providers.controller';

/**
 * Routes des fournisseurs, montées sur un vrai routeur Hono avec le registre
 * et l'exécuteur de gardes du framework. Les deux gardes d'accès sont
 * remplacées par des leurres qui en suivent le contrat (la session passe ou
 * non ; l'accès au serveur pose le serveur vérifié puis passe ou non) : leur
 * décision, elle, est celle de `auth/guards`, hors de cette page.
 *
 * Ce que ces épreuves fixent : chaque route exige les deux gardes ; une
 * réponse ne montre JAMAIS la clé (même quand un contrôle échoue en la
 * recopiant) ; une clé vide conserve le secret, `null` le retire ; un
 * fournisseur d'un AUTRE serveur répond 404, comme un identifiant inconnu.
 */

const KEY = 'test-key-not-real';
const NEW_KEY = 'test-key-not-real-either';
const GUILD = '1550000000000000001';
const OTHER_GUILD = '1550000000000000008';
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
      // Même contrat que la garde réelle : le serveur vérifié est posé dans la requête, pour le contrôleur ; un refus lève 403.
      ctx.set('guildAccess', { guildId: ctx.req.param('guildId'), discordUserId: USER });
      if (!(await guards.guild(ctx))) throw new ForbiddenError('Accès refusé.');
      return true;
    }
  },
}));

const MODEL: ProviderModel = { id: 'modèle-a', kinds: ['chat'], origin: 'discovered' };

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
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
    models: [MODEL],
    enabled: true,
    ...overrides,
  };
}

const PROVIDERS: ProviderConfig[] = [config(), config({ id: 'provider-2', guildId: OTHER_GUILD, slug: 'ailleurs' })];

/** Store factice : il ne garde du serveur demandé que ce qui lui appartient, et applique la convention de la clé. */
function fakeStore() {
  return {
    list: vi.fn(async (guildId: string) => PROVIDERS.filter((provider) => provider.guildId === guildId)),
    get: vi.fn(async (guildId: string, providerId: string) => PROVIDERS.find((provider) => provider.guildId === guildId && (provider.id === providerId || provider.slug === providerId)) ?? null),
    slugIndex: vi.fn(async (guildId: string) => PROVIDERS.filter((provider) => provider.guildId === guildId).map((provider) => ({ id: provider.id, slug: provider.slug }))),
    upsert: vi.fn(async (guildId: string, input: ProviderInput): Promise<ProviderConfig> => {
      const existing = PROVIDERS.find((provider) => provider.guildId === guildId && provider.slug === input.slug);
      return config({
        ...(existing ?? {}),
        guildId,
        slug: input.slug,
        displayName: input.displayName ?? existing?.displayName ?? '',
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        authType: input.authType ?? existing?.authType ?? 'bearer',
        apiKey: input.apiKey === undefined ? (existing?.apiKey ?? null) : input.apiKey,
      });
    }),
    remove: vi.fn(async (guildId: string, providerId: string) => PROVIDERS.some((provider) => provider.guildId === guildId && provider.id === providerId)),
    saveModels: vi.fn(async () => undefined),
    catalog: {
      addManual: vi.fn(async () => [MODEL, { id: 'slug-ajoute', origin: 'manual' }]),
      removeManual: vi.fn(async () => ({ outcome: 'discovered', models: [MODEL] })),
    },
  };
}

const adapter = { testConnection: vi.fn(), discoverModels: vi.fn(), supports: vi.fn(), execute: vi.fn(), chat: vi.fn() };

function mount(store = fakeStore()) {
  const health = new ProviderHealthService();
  const audit = { record: vi.fn() };
  const registry = { resolve: vi.fn(() => adapter) };
  const controller = new ProvidersController(store as never, registry as never, health, audit as never);
  const app = apiHarness(new Map()).serve(controller);
  return { app, store, health, audit, registry };
}

beforeEach(() => {
  guards.session.mockResolvedValue(true);
  guards.guild.mockResolvedValue(true);
  adapter.testConnection.mockReset();
  adapter.discoverModels.mockReset();
});

describe('ProvidersController · routes', () => {
  it('declare huit routes, chacune sous la session puis l\u0027accès au serveur', () => {
    const routes = declaredRoutes(new ProvidersController(fakeStore() as never, { resolve: vi.fn() } as never, new ProviderHealthService(), { record: vi.fn() } as never), [SessionGuard, GuildAccessGuard]);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /api/v1/guilds/:guildId/providers',
      'POST /api/v1/guilds/:guildId/providers',
      'PATCH /api/v1/guilds/:guildId/providers/:providerId',
      'DELETE /api/v1/guilds/:guildId/providers/:providerId',
      'POST /api/v1/guilds/:guildId/providers/:providerId/test',
      'GET /api/v1/guilds/:guildId/providers/:providerId/models',
      'POST /api/v1/guilds/:guildId/providers/:providerId/models',
      'DELETE /api/v1/guilds/:guildId/providers/:providerId/models/:modelId',
    ]);
    expect(routes.every((route) => route.guards)).toBe(true);
  });

  it('sans session : 401 sur chaque route, et rien n\u0027est lu ni écrit', async () => {
    guards.session.mockResolvedValue(false);
    const { app, store } = mount();
    for (const [method, path] of [['GET', '/providers'], ['POST', '/providers'], ['PATCH', '/providers/provider-1'], ['DELETE', '/providers/provider-1'], ['POST', '/providers/provider-1/test'], ['GET', '/providers/provider-1/models']] as const) {
      expect((await request(app, method, `${BASE}${path}`, method === 'POST' && path === '/providers' ? {} : undefined)).status).toBe(401);
    }
    expect(store.list).not.toHaveBeenCalled();
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('sans droit de gestion : 403, et rien n\u0027est lu', async () => {
    guards.guild.mockResolvedValue(false);
    const { app, store } = mount();
    expect((await request(app, 'GET', `${BASE}/providers`)).status).toBe(403);
    expect(store.list).not.toHaveBeenCalled();
  });
});

describe('ProvidersController · lectures', () => {
  it('la liste ne montre jamais la clé : sa présence et son indice, et rien du serveur voisin', async () => {
    const { app } = mount();
    const reply = await request(app, 'GET', `${BASE}/providers`);
    expect(reply.status).toBe(200);
    const providers = ProviderViewSchema.array().parse(reply.body?.providers);
    expect(providers.map((provider) => provider.slug)).toEqual(['openrouter']);
    expect(providers[0]?.key).toEqual({ hasApiKey: true, keyHint: '\u2022\u2022\u2022\u2022real' });
    expect(JSON.stringify(reply.body)).not.toContain(KEY);
    expect('apiKey' in ((reply.body?.providers as Array<Record<string, unknown>>)[0] ?? {})).toBe(false);
  });

  it('un fournisseur d\u0027un autre serveur répond 404, comme un identifiant inconnu', async () => {
    const { app, store } = mount();
    expect((await request(app, 'GET', `${BASE}/providers/provider-2/models`)).status).toBe(404);
    expect((await request(app, 'GET', `${BASE}/providers/inconnu/models`)).status).toBe(404);
    expect(store.get).toHaveBeenCalledWith(GUILD, 'provider-2');
  });

  it('le catalogue donne les modèles avec leur origine', async () => {
    const { app } = mount();
    const reply = await request(app, 'GET', `${BASE}/providers/openrouter/models`);
    expect(reply.status).toBe(200);
    expect(reply.body?.models).toEqual([expect.objectContaining({ id: 'modèle-a', origin: 'discovered' })]);
  });
});

describe('ProvidersController · écritures', () => {
  const BODY = { displayName: 'Nouveau', protocol: 'openai-chat', baseUrl: 'https://api.exemple.test/v1', authType: 'bearer' };

  it('créer : le corps devient une création sans clé, le slug se déduit, la réponse est enroulée', async () => {
    const { app, store } = mount();
    const reply = await request(app, 'POST', `${BASE}/providers`, BODY);
    expect(reply.status).toBe(200);
    expect(reply.body?.provider).toMatchObject({ slug: 'nouveau', displayName: 'Nouveau', key: { hasApiKey: false, keyHint: null } });
    expect(store.upsert).toHaveBeenCalledWith(GUILD, expect.objectContaining({ slug: 'nouveau', apiKey: undefined, baseUrl: BODY.baseUrl }), USER, 'api');
  });

  it('créer avec un slug déjà pris : 409, et rien n\u0027est écrit', async () => {
    const { app, store } = mount();
    const reply = await request(app, 'POST', `${BASE}/providers`, { ...BODY, slug: 'openrouter' });
    expect(reply.status).toBe(409);
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('créer avec un corps qui ne respecte pas le contrat : 400, avec le champ en cause', async () => {
    const { app, store } = mount();
    const reply = await request(app, 'POST', `${BASE}/providers`, { protocol: 'openai-chat', baseUrl: 'https://api.exemple.test/v1' });
    expect(reply.status).toBe(400);
    expect(reply.body?.details).toEqual([expect.objectContaining({ property: 'displayName' })]);
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('modifier avec une clé vide conserve le secret ; `null` le retire ; une clé saisie le remplace', async () => {
    const { app, store } = mount();
    const kept = await request(app, 'PATCH', `${BASE}/providers/provider-1`, { apiKey: '' });
    expect(kept.status).toBe(200);
    expect(store.upsert).toHaveBeenLastCalledWith(GUILD, expect.objectContaining({ apiKey: undefined }), USER, 'api');
    expect(kept.body?.provider).toMatchObject({ key: { hasApiKey: true } });

    const cleared = await request(app, 'PATCH', `${BASE}/providers/provider-1`, { apiKey: null });
    expect(cleared.body?.provider).toMatchObject({ key: { hasApiKey: false, keyHint: null } });

    const replaced = await request(app, 'PATCH', `${BASE}/providers/provider-1`, { apiKey: NEW_KEY });
    expect(store.upsert).toHaveBeenLastCalledWith(GUILD, expect.objectContaining({ apiKey: NEW_KEY }), USER, 'api');
    expect(JSON.stringify([kept.body, cleared.body, replaced.body])).not.toContain(KEY);
    expect(JSON.stringify([kept.body, cleared.body, replaced.body])).not.toContain(NEW_KEY);
  });

  it('modifier un fournisseur inconnu : 404, rien n\u0027est écrit', async () => {
    const { app, store } = mount();
    expect((await request(app, 'PATCH', `${BASE}/providers/inconnu`, { displayName: 'X' })).status).toBe(404);
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('supprimer : { removed: true } ; inconnu : 404', async () => {
    const { app, store } = mount();
    expect(await request(app, 'DELETE', `${BASE}/providers/provider-1`)).toEqual({ status: 200, body: { removed: true } });
    store.remove.mockResolvedValueOnce(false);
    expect((await request(app, 'DELETE', `${BASE}/providers/provider-2`)).status).toBe(404);
  });

  it('un slug saisi à la main s\u0027ajoute ; un modèle du fournisseur ne se retire pas (422)', async () => {
    const { app, store } = mount();
    const added = await request(app, 'POST', `${BASE}/providers/provider-1/models`, { modelId: 'slug-ajoute' });
    expect(added.status).toBe(200);
    expect(added.body?.models).toEqual([expect.objectContaining({ id: 'modèle-a' }), expect.objectContaining({ id: 'slug-ajoute', origin: 'manual' })]);
    expect(store.catalog.addManual).toHaveBeenCalledWith(GUILD, 'provider-1', 'slug-ajoute', USER, 'api');
    const refused = await request(app, 'DELETE', `${BASE}/providers/provider-1/models/modèle-a`);
    expect(refused.status).toBe(422);
  });
});

describe('ProvidersController · contrôle de connexion', () => {
  it('un contrôle qui échoue est un résultat (200), sans la clé que l\u0027erreur recopiait, et nourrit la santé', async () => {
    adapter.testConnection.mockResolvedValue({ ok: false, summary: `Clé ${KEY} refusée par le fournisseur.`, modelsFound: 0 });
    const { app, audit } = mount();
    const reply = await request(app, 'POST', `${BASE}/providers/provider-1/test`);
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ ok: false, modelsFound: 0, status: { state: 'error' } });
    expect(JSON.stringify(reply.body)).not.toContain(KEY);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'provider.tested', source: 'api', actorId: USER, metadata: { providerId: 'provider-1', slug: 'openrouter', ok: false, modelsFound: 0 } }));
  });

  it('un contrôle réussi découvre le catalogue et passe la santé en actif', async () => {
    adapter.testConnection.mockResolvedValue({ ok: true, summary: 'Connecté.', modelsFound: 1 });
    adapter.discoverModels.mockResolvedValue([MODEL]);
    const { app, store } = mount();
    const reply = await request(app, 'POST', `${BASE}/providers/provider-1/test`);
    expect(reply.body).toMatchObject({ ok: true, modelsFound: 1, status: { state: 'active' } });
    expect(store.saveModels).toHaveBeenCalledWith(GUILD, 'provider-1', [MODEL]);
  });
});
