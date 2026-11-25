import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import { ForbiddenError } from '@spraxium/http';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildAccessGuard } from '../../auth/guards/guild-access.guard';
import { RequestProgressService } from '../assistant/request-progress.service';
import { apiHarness, declaredRoutes, request } from './controller.test-support';
import { AUDIT_KINDS, AgentChatSchema, auditKindOf, auditPageOf, auditWhere, webAgentRefusal } from './guilds.support';
import { GuildsController } from './guilds.controller';

/**
 * Routes des serveurs, montées sur un vrai routeur Hono (les deux gardes
 * d’accès sont des leurres qui en suivent le contrat). Ce qui est fixé ici,
 * côté sécurité : la liste des serveurs se fonde sur l’identité Discord LIÉE à
 * la session (jamais l’identifiant de la session) ; le journal se filtre par
 * famille, une famille inconnue est refusée ; le chat de l’agent part avec le
 * membre vérifié par la garde ; les étapes d’une demande ne se lisent que
 * depuis SON serveur.
 */

const GUILD = '1550000000000000001';
const OTHER = '1550000000000000008';
const USER = '1550000000000000002';
const SESSION_USER = 'user-better-auth-0001';
const REQUEST = 'web-0f1e2d3c-4b5a';
const BASE = `http://localhost/api/v1/guilds`;
// Clé calculée : le scanner du registre des outils lit, dans toute source suivie, une clé name suivie d'une chaîne littérale.
const NAME = 'name';

const guards = vi.hoisted(() => ({
  session: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
  guild: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
}));

vi.mock('../../auth/guards/session.guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/guards/session.guard')>()),
  SessionGuard: class {
    async canActivate(ctx: Context): Promise<boolean> {
      if (!(await guards.session(ctx))) return false;
      // Même contrat que la garde réelle : la session lue est posée dans la requête, pour le contrôleur.
      ctx.set('session', { session: { id: 's1', userId: SESSION_USER }, user: { id: SESSION_USER, [NAME]: 'Test' } });
      return true;
    }
  },
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

const LINKED = '1550000000000000002';

function mount(options: { manageable?: boolean[]; linked?: string | null } = {}) {
  const prisma = {
    account: { findFirst: vi.fn(async () => (options.linked === null ? null : { accountId: options.linked ?? LINKED })) },
    auditLog: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    guildMemory: { findMany: vi.fn(async () => []) },
    memberMemory: { findMany: vi.fn(async () => []) },
    modCase: { count: vi.fn(async () => 0), groupBy: vi.fn(async () => []) },
  };
  const guilds = ['1550000000000000001', OTHER].map((id, index) => {
    const manageable = options.manageable?.[index] ?? true;
    return {
      id,
      name: `Serveur ${index}`,
      memberCount: 10 + index,
      iconURL: () => `https://cdn.discordapp.com/icons/${id}/icone.png`,
      members: { fetch: vi.fn(async (userId: string) => ({ id: userId, permissions: { toArray: () => (manageable ? ['ManageGuild'] : []) } })) },
    };
  });
  const client = { guilds: { cache: new Map(guilds.map((guild) => [guild.id, guild])), fetch: vi.fn() }, channels: { fetch: vi.fn() } };
  const webAgent = { chat: vi.fn(async () => ({ reply: 'Réponse', silent: false, tools: [] })) };
  const progress = new RequestProgressService();
  const modules = { listModules: vi.fn(async () => []), find: vi.fn(() => null), enableModule: vi.fn(), disableModule: vi.fn() };
  const controller = new GuildsController(modules as never, { get: vi.fn(), patch: vi.fn() } as never, { getConstraints: vi.fn() } as never, prisma as never, webAgent as never, client as never, progress);
  const app = apiHarness(new Map()).serve(controller);
  return { app, prisma, webAgent, progress, client };
}

beforeEach(() => {
  guards.session.mockResolvedValue(true);
  guards.guild.mockResolvedValue(true);
});

describe('GuildsController · routes', () => {
  it('déclare ses routes : la liste sous la session seule, toute route d’un serveur sous les deux gardes', () => {
    const routes = declaredRoutes(new GuildsController({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never), [SessionGuard, GuildAccessGuard]);
    expect(routes.length).toBeGreaterThanOrEqual(11);
    expect(routes.find((route) => route.method === 'GET' && route.path === '/api/v1/guilds')).toMatchObject({ guards: true, handler: 'list' });
    expect(routes.find((route) => route.method === 'GET' && route.path === '/api/v1/guilds/')).toMatchObject({ guards: true, handler: 'list' });
    const guildRoutes = routes.filter((route) => route.path.includes(':guildId'));
    expect(guildRoutes.every((route) => route.guards)).toBe(true);
    expect(routes.map((route) => route.path)).toEqual(expect.arrayContaining(['/api/v1/guilds/:guildId/agent/chat', '/api/v1/guilds/:guildId/agent/requests/:requestId', '/api/v1/guilds/:guildId/audit']));
  });
});

describe('GuildsController · liste des serveurs', () => {
  it('répond avec et sans barre finale : le routeur est strict, le dashboard demande sans', async () => {
    const { app } = mount();
    for (const path of [`${BASE}`, `${BASE}/`]) {
      const reply = await request(app, 'GET', path);
      expect(reply.status, path).toBe(200);
      expect(reply.body?.guilds, path).toHaveLength(2);
    }
  });

  it('se fonde sur l’identité Discord liée à la session, jamais sur l’identifiant de la session', async () => {
    const { app, client } = mount();
    const reply = await request(app, 'GET', `${BASE}`);
    expect(reply.status).toBe(200);
    expect(reply.body?.guilds).toEqual([
      { id: GUILD, name: 'Serveur 0', icon: 'https://cdn.discordapp.com/icons/1550000000000000001/icone.png', memberCount: 10, canManage: true },
      { id: OTHER, name: 'Serveur 1', icon: 'https://cdn.discordapp.com/icons/1550000000000000008/icone.png', memberCount: 11, canManage: true },
    ]);
    for (const guild of client.guilds.cache.values()) expect(guild.members.fetch).toHaveBeenCalledWith(LINKED);
    expect(JSON.stringify(client.guilds.cache.values().next().value?.members.fetch.mock.calls)).not.toContain(SESSION_USER);
  });

  it('sans compte Discord lié, aucun serveur n’est listé ; sans le droit de gérer, le serveur est omis', async () => {
    expect((await request(mount({ linked: null }).app, 'GET', `${BASE}`)).body).toEqual({ guilds: [] });
    const reply = await request(mount({ manageable: [true, false] }).app, 'GET', `${BASE}`);
    expect(reply.body?.guilds).toEqual([expect.objectContaining({ id: GUILD })]);
  });

  it('sans session : 401', async () => {
    guards.session.mockResolvedValue(false);
    expect((await request(mount().app, 'GET', `${BASE}`)).status).toBe(401);
  });
});

describe('GuildsController · journal', () => {
  it('la page demandée se lit, la famille filtre la requête, une famille inconnue est refusée (400)', async () => {
    const { app, prisma } = mount();
    expect((await request(app, 'GET', `${BASE}/${GUILD}/audit?page=3&kind=plans`)).status).toBe(200);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: GUILD, OR: [{ action: { startsWith: 'plan.' } }] }, skip: 50, take: 25 }));
    await request(app, 'GET', `${BASE}/${GUILD}/audit?kind=errors`);
    expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { guildId: GUILD, OR: [{ action: 'assistant.error' }, { action: { startsWith: 'tool.denied.' } }, { action: 'rule.confirm.denied' }] } }));
    await request(app, 'GET', `${BASE}/${GUILD}/audit?kind=actions&page=99999999`);
    expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { guildId: GUILD, NOT: { OR: expect.any(Array) } }, skip: (10_000 - 1) * 25 }));
    const refused = await request(app, 'GET', `${BASE}/${GUILD}/audit?kind=secret`);
    expect(refused.status).toBe(400);
    expect(refused.body?.details).toEqual([expect.objectContaining({ property: 'kind' })]);
  });

  it('les familles proposées au panel, et leurs filtres', () => {
    expect(AUDIT_KINDS).toEqual(['all', 'actions', 'plans', 'errors']);
    expect(auditKindOf(undefined)).toBeNull();
    expect(auditKindOf('all')).toBeNull();
    expect(auditWhere(GUILD, null)).toEqual({ guildId: GUILD });
    for (const bad of ['page=-5', 'page=abc', 'page=0']) expect(auditPageOf(bad), bad).toBe(1);
    expect(auditPageOf('12')).toBe(12);
  });
});

describe('GuildsController · agent', () => {
  const CHAT = `${BASE}/${GUILD}/agent/chat`;

  it('le chat part avec le membre Discord vérifié par la garde, et l’identifiant de demande choisi par le panel', async () => {
    const { app, webAgent } = mount();
    const reply = await request(app, 'POST', CHAT, { message: '  liste les fiches  ', requestId: REQUEST });
    expect(reply.status).toBe(200);
    expect(webAgent.chat).toHaveBeenCalledWith(GUILD, USER, 'liste les fiches', REQUEST);
    await request(app, 'POST', CHAT, { message: 'sans identifiant' });
    expect(webAgent.chat).toHaveBeenLastCalledWith(GUILD, USER, 'sans identifiant', undefined);
  });

  it('un message vide, trop long, ou un identifiant mal formé : 400, et l’agent n’est pas appelé', async () => {
    const { app, webAgent } = mount();
    for (const body of [{ message: '   ' }, { message: 'x'.repeat(2_001) }, {}, { message: 'ok', requestId: 'abc' }, { message: 'ok', requestId: 'web-../../../etc' }]) {
      expect((await request(app, 'POST', CHAT, body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect(webAgent.chat).not.toHaveBeenCalled();
    expect(AgentChatSchema.safeParse({ message: 'ok', requestId: `web-${'a'.repeat(36)}` }).success).toBe(true);
    expect(AgentChatSchema.safeParse({ message: 'ok', requestId: `web-${'a'.repeat(37)}` }).success).toBe(false);
  });

  it('les refus de l’agent : cadence en 429, le reste en 400 avec la phrase à montrer', async () => {
    const { app, webAgent } = mount();
    webAgent.chat.mockRejectedValueOnce(new Error('Trop de demandes : attends quelques secondes.'));
    expect((await request(app, 'POST', CHAT, { message: 'encore' })).status).toBe(429);
    webAgent.chat.mockRejectedValueOnce(new Error("Tu n'es pas membre de ce serveur Discord."));
    const refused = await request(app, 'POST', CHAT, { message: 'encore' });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: "Tu n'es pas membre de ce serveur Discord." });
    expect(webAgentRefusal(new Error('x'.repeat(250)))).toBeNull();
    expect(webAgentRefusal('texte')).toBeNull();
  });

  it('les étapes d’une demande ne se lisent que depuis SON serveur', async () => {
    const { app, progress } = mount();
    progress.start(OTHER, REQUEST);
    progress.record(OTHER, REQUEST, { [NAME]: 'outil.ailleurs', ok: true, summary: 'd\u0027un autre serveur' });
    const foreign = await request(app, 'GET', `${BASE}/${GUILD}/agent/requests/${REQUEST}`);
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(foreign.body)).not.toContain('ailleurs');
    expect((await request(app, 'GET', `${BASE}/${GUILD}/agent/requests/web-inconnue-0001`)).status).toBe(404);
    progress.start(GUILD, REQUEST);
    progress.record(GUILD, REQUEST, { name: 'records.list', ok: true, summary: '3 fiches' });
    const own = await request(app, 'GET', `${BASE}/${GUILD}/agent/requests/${REQUEST}`);
    expect(own.status).toBe(200);
    expect(own.body).toEqual({ requestId: REQUEST, state: 'running', steps: [{ name: 'records.list', ok: true, summary: '3 fiches' }] });
  });

  it('sans le droit de gérer le serveur : 403, ni l’agent ni ses étapes ne sont atteints', async () => {
    guards.guild.mockResolvedValue(false);
    const { app, webAgent } = mount();
    expect((await request(app, 'POST', CHAT, { message: 'salut' })).status).toBe(403);
    expect((await request(app, 'GET', `${BASE}/${GUILD}/agent/requests/${REQUEST}`)).status).toBe(403);
    expect(webAgent.chat).not.toHaveBeenCalled();
  });
});
