import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import { ForbiddenError } from '@spraxium/http';
import type { WebhookCreate, WebhookEndpointView, WebhookPingResult, WebhookUpdate } from '@10cordes/shared';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildAccessGuard } from '../../auth/guards/guild-access.guard';
import { WebhookEndpointError } from '../webhooks/webhook-endpoint.errors';
import { apiHarness, declaredRoutes, request } from './controller.test-support';
import { WebhooksController } from './webhooks.controller';

/**
 * Routes des connecteurs HTTP sortants, montées sur un vrai routeur Hono avec
 * le registre et l'exécuteur de gardes du framework (les deux gardes d'accès
 * sont des leurres qui en suivent le contrat). Le service est factice : il
 * suit ses conventions (une ressource absente rend null, un refus lève une
 * erreur typée). Ce que ces épreuves fixent : les cinq routes exigent les
 * deux gardes ; une réponse ne montre jamais la valeur d'un en-tête secret ;
 * un champ absent du corps part absent au service (le secret est conservé) ;
 * un refus du domaine prend son statut (422, 409).
 */

const SECRET = 'test-key-not-real';
const GUILD = '1550000000000000001';
const USER = '1550000000000000002';
const BASE = `http://localhost/api/v1/guilds/${GUILD}`;
// Clé calculée : le scanner du registre des outils lit, dans toute source suivie, une clé name suivie d'une chaîne littérale.
const NAME = 'name';

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

const VIEW: WebhookEndpointView = {
  webhookId: 'hook-1',
  slug: 'alerte',
  [NAME]: 'Alerte',
  method: 'POST',
  url: 'https://hooks.exemple.test/v1',
  domain: 'hooks.exemple.test',
  authType: 'bearer',
  authHeaderName: 'Authorization',
  publicHeaders: { 'X-Org': 'test' },
  secretHeaderNames: ['Authorization'],
  requestTemplate: { text: 'x' },
  responseExtractPath: 'data.result',
  enabled: true,
  lastHttpStatus: 200,
  lastCheckedAt: '2026-11-25T07:30:00.000Z',
  lastError: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-24T10:00:00.000Z',
};

function mount() {
  const service = {
    list: vi.fn(async () => [VIEW]),
    create: vi.fn(async (_guildId: string, input: WebhookCreate): Promise<WebhookEndpointView> => {
      if (input.url.startsWith('http://')) throw new WebhookEndpointError('URL refusée : https obligatoire, sur un hôte public.', 'invalid');
      if (input.slug === 'alerte') throw new WebhookEndpointError('Slug « alerte » déjà pris sur ce serveur.', 'conflict');
      return { ...VIEW, webhookId: 'hook-2', slug: input.slug, url: input.url };
    }),
    update: vi.fn(async (guildId: string, webhookId: string, _input: WebhookUpdate) => (guildId === GUILD && webhookId === 'hook-1' ? VIEW : null)),
    remove: vi.fn(async (guildId: string, webhookId: string) => guildId === GUILD && webhookId === 'hook-1'),
    ping: vi.fn(async (guildId: string, webhookId: string): Promise<WebhookPingResult | null> => (guildId === GUILD && webhookId === 'hook-1' ? { ok: true, status: 200, summary: 'Reçu.', extracted: 'ok', ms: 12 } : null)),
  };
  const app = apiHarness(new Map()).serve(new WebhooksController(service as never));
  return { app, service };
}

beforeEach(() => {
  guards.session.mockResolvedValue(true);
  guards.guild.mockResolvedValue(true);
});

const CREATE: WebhookCreate = { slug: 'nouveau', [NAME]: 'Nouveau', method: 'POST', url: 'https://hooks.exemple.test/nouveau', secretHeaders: { Authorization: `Bearer ${SECRET}` } };

describe('WebhooksController', () => {
  it('declare cinq routes, chacune sous la session puis l\u0027accès au serveur', () => {
    const routes = declaredRoutes(new WebhooksController({} as never), [SessionGuard, GuildAccessGuard]);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /api/v1/guilds/:guildId/webhooks',
      'POST /api/v1/guilds/:guildId/webhooks',
      'PATCH /api/v1/guilds/:guildId/webhooks/:webhookId',
      'DELETE /api/v1/guilds/:guildId/webhooks/:webhookId',
      'POST /api/v1/guilds/:guildId/webhooks/:webhookId/ping',
    ]);
    expect(routes.every((route) => route.guards)).toBe(true);
  });

  it('sans session ni droit : rien n\u0027est lu ni écrit', async () => {
    const { app, service } = mount();
    guards.session.mockResolvedValue(false);
    expect((await request(app, 'GET', `${BASE}/webhooks`)).status).toBe(401);
    expect((await request(app, 'POST', `${BASE}/webhooks`, CREATE)).status).toBe(401);
    guards.session.mockResolvedValue(true);
    guards.guild.mockResolvedValue(false);
    expect((await request(app, 'GET', `${BASE}/webhooks`)).status).toBe(403);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });

  it('la liste n\u0027a que les noms des en-têtes secrets, jamais leur valeur', async () => {
    const { app } = mount();
    const reply = await request(app, 'GET', `${BASE}/webhooks`);
    expect(reply.status).toBe(200);
    expect(reply.body?.webhooks).toEqual([VIEW]);
    expect(JSON.stringify(reply.body)).not.toContain(SECRET);
    expect(JSON.stringify(reply.body)).not.toContain('secretHeaders');
  });

  it('créer : le corps validé part au service, la réponse est enroulée et sans secret', async () => {
    const { app, service } = mount();
    const reply = await request(app, 'POST', `${BASE}/webhooks`, CREATE);
    expect(reply.status).toBe(200);
    expect(reply.body?.webhook).toMatchObject({ webhookId: 'hook-2', slug: 'nouveau', secretHeaderNames: ['Authorization'] });
    expect(JSON.stringify(reply.body)).not.toContain(SECRET);
    expect(service.create).toHaveBeenCalledWith(GUILD, CREATE, USER, 'api');
  });

  it('créer avec une adresse refusée : 422 ; un slug pris : 409 ; un corps hors contrat : 400', async () => {
    const { app } = mount();
    expect((await request(app, 'POST', `${BASE}/webhooks`, { ...CREATE, url: 'http://hooks.exemple.test/nouveau' })).status).toBe(422);
    expect((await request(app, 'POST', `${BASE}/webhooks`, { ...CREATE, slug: 'alerte' })).status).toBe(409);
    const invalid = await request(app, 'POST', `${BASE}/webhooks`, { slug: 'x', [NAME]: 'X' });
    expect(invalid.status).toBe(400);
    expect(invalid.body?.details).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'method' }), expect.objectContaining({ property: 'url' })]));
  });

  it('modifier : un champ absent part absent (le secret est conservé) ; inconnu : 404', async () => {
    const { app, service } = mount();
    const reply = await request(app, 'PATCH', `${BASE}/webhooks/hook-1`, { name: 'Renommé' });
    expect(reply.status).toBe(200);
    expect(reply.body?.webhook).toMatchObject({ webhookId: 'hook-1' });
    const [, , input] = service.update.mock.calls[0] as [string, string, WebhookUpdate];
    expect(input).toEqual({ name: 'Renommé' });
    expect('secretHeaders' in input).toBe(false);
    expect((await request(app, 'PATCH', `${BASE}/webhooks/ailleurs`, { [NAME]: 'X' })).status).toBe(404);
  });

  it('supprimer : { removed: true } ; inconnu : 404', async () => {
    const { app } = mount();
    expect(await request(app, 'DELETE', `${BASE}/webhooks/hook-1`)).toEqual({ status: 200, body: { removed: true } });
    expect((await request(app, 'DELETE', `${BASE}/webhooks/ailleurs`)).status).toBe(404);
  });

  it('un ping rend le résultat du service ; inconnu : 404', async () => {
    const { app, service } = mount();
    expect(await request(app, 'POST', `${BASE}/webhooks/hook-1/ping`)).toEqual({ status: 200, body: { ok: true, status: 200, summary: 'Reçu.', extracted: 'ok', ms: 12 } });
    expect(service.ping).toHaveBeenCalledWith(GUILD, 'hook-1', USER, 'api');
    expect((await request(app, 'POST', `${BASE}/webhooks/ailleurs/ping`)).status).toBe(404);
  });
});
