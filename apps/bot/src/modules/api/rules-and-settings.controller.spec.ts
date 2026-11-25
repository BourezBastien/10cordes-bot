import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import { ForbiddenError } from '@spraxium/http';
import type { GuildRules, GuildRulesPatch } from '@10cordes/shared';
import { GuildRulesSchema } from '@10cordes/shared';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildAccessGuard } from '../../auth/guards/guild-access.guard';
import { apiHarness, declaredRoutes, request } from './controller.test-support';
import { AgentSettingsController } from './agent-settings.controller';
import { RulesController } from './rules.controller';

/**
 * Routes des règles et du réglage de l'agent, montées sur un vrai routeur
 * Hono avec le registre et l'exécuteur de gardes du framework (les deux
 * gardes d'accès sont des leurres qui en suivent le contrat). Ce que ces
 * épreuves fixent : chaque route exige les deux gardes ; seule la partie
 * changée part au service, avec l'utilisateur Discord de la session ; un
 * corps hors contrat est refusé en 400 avec le champ en cause.
 */

const GUILD = '1550000000000000001';
const USER = '1550000000000000002';
const BASE = `http://localhost/api/v1/guilds/${GUILD}`;

const CHANNEL = '1550000000000000003';

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

const RULES: GuildRules = {
  freeCategoryIds: [],
  freeChannelIds: [CHANNEL],
  blockedChannelIds: [],
  strictMentionElsewhere: true,
  seriousOnlyElsewhere: false,
  confirmDestructiveActions: false,
  customInstructions: ['Réponds en français.'],
};

beforeEach(() => {
  guards.session.mockResolvedValue(true);
  guards.guild.mockResolvedValue(true);
});

function mountRules() {
  const rules = {
    get: vi.fn(async () => RULES),
    apply: vi.fn(async (_guildId: string, patch: Partial<GuildRules>) => ({ ...RULES, ...patch })),
  };
  const app = apiHarness(new Map()).serve(new RulesController(rules as never));
  return { app, rules };
}

function mountSettings() {
  const settings = {
    get: vi.fn(async () => ({ thinkingMode: 'adaptive', channelId: '1550000000000000009' })),
    patch: vi.fn(async (_guildId: string, input: { thinkingMode: string }) => ({ thinkingMode: input.thinkingMode, channelId: '1550000000000000009' })),
  };
  const app = apiHarness(new Map()).serve(new AgentSettingsController(settings as never));
  return { app, settings };
}

describe('RulesController', () => {
  it('declare deux routes, chacune sous la session puis l\u0027accès au serveur', () => {
    const routes = declaredRoutes(new RulesController({} as never), [SessionGuard, GuildAccessGuard]);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual(['GET /api/v1/guilds/:guildId/rules', 'PATCH /api/v1/guilds/:guildId/rules']);
    expect(routes.every((route) => route.guards)).toBe(true);
  });

  it('sans session ni droit : rien n\u0027est lu ni écrit', async () => {
    const { app, rules } = mountRules();
    guards.session.mockResolvedValue(false);
    expect((await request(app, 'GET', `${BASE}/rules`)).status).toBe(401);
    guards.session.mockResolvedValue(true);
    guards.guild.mockResolvedValue(false);
    expect((await request(app, 'PATCH', `${BASE}/rules`, { strictMentionElsewhere: false })).status).toBe(403);
    expect(rules.get).not.toHaveBeenCalled();
    expect(rules.apply).not.toHaveBeenCalled();
  });

  it('la lecture rend les règles en objet direct, conformes au contrat', async () => {
    const { app } = mountRules();
    const reply = await request(app, 'GET', `${BASE}/rules`);
    expect(reply.status).toBe(200);
    expect(GuildRulesSchema.parse(reply.body)).toEqual(RULES);
  });

  it('un patch partiel : seuls les champs fournis changent, la réponse est { rules }', async () => {
    const { app, rules } = mountRules();
    const patch: GuildRulesPatch = { confirmDestructiveActions: true, addCustomInstructions: ['Tutoie les membres.'], removeCustomInstructions: ['Réponds en français.'] };
    const reply = await request(app, 'PATCH', `${BASE}/rules`, patch);
    expect(reply.status).toBe(200);
    expect(GuildRulesSchema.parse(reply.body?.rules)).toMatchObject({ confirmDestructiveActions: true, strictMentionElsewhere: true });
    expect(rules.apply).toHaveBeenCalledWith(GUILD, patch, USER, 'api');
  });

  it('un corps hors contrat : 400 avec le champ en cause, rien n\u0027est écrit', async () => {
    const { app, rules } = mountRules();
    const empty = await request(app, 'PATCH', `${BASE}/rules`, {});
    expect(empty.status).toBe(400);
    const badChannel = await request(app, 'PATCH', `${BASE}/rules`, { blockedChannelIds: ['12'] });
    expect(badChannel.status).toBe(400);
    expect(badChannel.body?.details).toEqual([expect.objectContaining({ property: 'blockedChannelIds.0' })]);
    const unknownField = await request(app, 'PATCH', `${BASE}/rules`, { confirmDestructiveActions: 'oui' });
    expect(unknownField.status).toBe(400);
    expect(rules.apply).not.toHaveBeenCalled();
  });
});

describe('AgentSettingsController', () => {
  it('declare deux routes, chacune sous la session puis l\u0027accès au serveur', () => {
    const routes = declaredRoutes(new AgentSettingsController({} as never), [SessionGuard, GuildAccessGuard]);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual(['GET /api/v1/guilds/:guildId/agent-settings', 'PATCH /api/v1/guilds/:guildId/agent-settings']);
    expect(routes.every((route) => route.guards)).toBe(true);
  });

  it('sans session ni droit : rien n\u0027est lu ni écrit', async () => {
    const { app, settings } = mountSettings();
    guards.session.mockResolvedValue(false);
    expect((await request(app, 'GET', `${BASE}/agent-settings`)).status).toBe(401);
    guards.session.mockResolvedValue(true);
    guards.guild.mockResolvedValue(false);
    expect((await request(app, 'PATCH', `${BASE}/agent-settings`, { thinkingMode: 'off' })).status).toBe(403);
    expect(settings.get).not.toHaveBeenCalled();
    expect(settings.patch).not.toHaveBeenCalled();
  });

  it('la lecture rend le seul champ du contrat ; le fil privé du service (l\u0027identifiant du salon) ne sort pas', async () => {
    const { app } = mountSettings();
    expect(await request(app, 'GET', `${BASE}/agent-settings`)).toEqual({ status: 200, body: { thinkingMode: 'adaptive' } });
  });

  it('écrire : la réponse est { settings }, sans le fil privé ; un mode inconnu : 400', async () => {
    const { app, settings } = mountSettings();
    const reply = await request(app, 'PATCH', `${BASE}/agent-settings`, { thinkingMode: 'always' });
    expect(reply).toEqual({ status: 200, body: { settings: { thinkingMode: 'always' } } });
    expect(settings.patch).toHaveBeenCalledWith(GUILD, { thinkingMode: 'always' }, USER, 'api');
    const invalid = await request(app, 'PATCH', `${BASE}/agent-settings`, { thinkingMode: 'parfois' });
    expect(invalid.status).toBe(400);
    expect(invalid.body?.details).toEqual([expect.objectContaining({ property: 'thinkingMode' })]);
  });
});
