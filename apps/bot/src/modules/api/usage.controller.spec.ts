import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono, type Context } from 'hono';
import { BadRequestError, HTTP_METADATA_KEYS, RouteBuilder, RouteRegistry } from '@spraxium/http';
import type { UsageSummary, UsageWindow } from '@10cordes/shared';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildAccessGuard } from '../../auth/guards/guild-access.guard';
import { UsageReaderService } from '../usage/usage-reader.service';
import { UsageController } from './usage.controller';

/**
 * Route d'usage de la page Système, montée sur un vrai routeur Hono avec le
 * registre et l'exécuteur de gardes du framework (accès aux paramètres,
 * ordre des gardes, statut d'un refus). Les deux gardes d'accès sont
 * remplacées par des leurres qui en suivent le contrat : la session passe ou
 * non ; l'accès au serveur pose le serveur vérifié puis passe ou non. Leur
 * décision, elle, est celle de `auth/guards`, hors de cette page.
 */

const GUILD = '1550000000000000001';
const OTHER_GUILD = '1550000000000000008';
const USER = '1550000000000000002';
const ROUTE = (guildId: string = GUILD): string => `http://localhost/api/v1/guilds/${guildId}/usage`;

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
      // Même contrat que la garde réelle : le serveur vérifié est posé dans la requête, pour le contrôleur.
      ctx.set('guildAccess', { guildId: ctx.req.param('guildId'), discordUserId: USER });
      return guards.guild(ctx);
    }
  },
}));

/** Lecteur factice : sa réponse dit pour quel serveur et quelle fenêtre il a été interrogé. */
function fakeReader() {
  return {
    summary: vi.fn(async (guildId: string, window: UsageWindow): Promise<UsageSummary> => ({
      window,
      turns: 3,
      promptTokens: 545,
      completionTokens: 64,
      errors: 1,
      fallbacks: 2,
      byModel: [{ provider: 'deepseek-official', model: `modèle-de-${guildId}`, turns: 3, promptTokens: 545, completionTokens: 64, errors: 1, fallbacks: 2 }],
      byDay: [{ day: '2026-11-25', turns: 3, tokens: 609 }],
    })),
  };
}

/**
 * La route du contrôleur, montée comme le serveur HTTP du framework le fait
 * (le contrôleur reçoit son lecteur par le conteneur). Une erreur du handler
 * arrive ici telle quelle : c'est le serveur du framework qui la rend avec
 * son statut (`HttpError` : statut et message, sinon 500).
 */
function mount(reader: ReturnType<typeof fakeReader>): Hono {
  const deps = new Map<unknown, unknown>([[UsageReaderService, reader]]);
  const app = new Hono();
  app.onError((error) => {
    throw error;
  });
  RouteBuilder.register(app, new RouteRegistry().resolveAll([UsageController], deps), new Map(), deps);
  return app;
}

beforeEach(() => {
  guards.session.mockReset().mockResolvedValue(true);
  guards.guild.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('UsageController', () => {
  it('est montée sur GET /api/v1/guilds/:guildId/usage, derrière la session puis l\u0027accès au serveur', () => {
    expect(Reflect.getMetadata(HTTP_METADATA_KEYS.PREFIX, UsageController)).toBe('/api/v1/guilds');
    expect(Reflect.getMetadata(HTTP_METADATA_KEYS.ROUTES, UsageController)).toEqual([{ method: 'GET', path: '/:guildId/usage', handlerName: 'summary' }]);
    expect(Reflect.getMetadata(HTTP_METADATA_KEYS.GUARDS, UsageController.prototype, 'summary')).toEqual([SessionGuard, GuildAccessGuard]);
  });

  it('sans fenêtre : 24 heures, et le serveur compté est celui de la route', async () => {
    const reader = fakeReader();
    const app = mount(reader);
    const response = await app.request(ROUTE());
    expect(response.status).toBe(200);
    // La réponse est le résumé du lecteur, tel quel.
    expect(await response.json()).toEqual(await reader.summary(GUILD, '24h'));
    reader.summary.mockClear();
    expect((await app.request(`${ROUTE(OTHER_GUILD)}?window=30d`)).status).toBe(200);
    expect(reader.summary).toHaveBeenCalledTimes(1);
    expect(reader.summary).toHaveBeenCalledWith(OTHER_GUILD, '30d');
  });

  it.each(['7d', '30d'] as const)('fenêtre %s : rendue au lecteur telle quelle', async (window) => {
    const reader = fakeReader();
    const response = await mount(reader).request(`${ROUTE()}?window=${window}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ window });
    expect(reader.summary).toHaveBeenCalledWith(GUILD, window);
  });

  it.each(['48h', '7j', '30 d', ''])('une fenêtre inconnue (« %s ») est refusée en 400 avant toute lecture', async (window) => {
    const reader = fakeReader();
    // `app.request` rend une réponse ou une promesse : la promesse avale aussi le jet du handler.
    const failure: unknown = await Promise.resolve(mount(reader).request(`${ROUTE()}?window=${window}`)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BadRequestError);
    // Ce que le serveur du framework rend : le statut de l'erreur et son message.
    expect(failure).toMatchObject({ statusCode: 400, message: 'Fenêtre d\u0027usage inconnue : attendue l\u0027une de 24h, 7d, 30d.' });
    expect(reader.summary).not.toHaveBeenCalled();
  });

  it('sans session valide : 401, et la garde du serveur n\u0027est même pas consultée', async () => {
    guards.session.mockResolvedValue(false);
    const reader = fakeReader();
    const response = await mount(reader).request(ROUTE());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'Unauthorized' });
    expect(guards.guild).not.toHaveBeenCalled();
    expect(reader.summary).not.toHaveBeenCalled();
  });

  it('sans accès au serveur : la requête s\u0027arrête avant la lecture', async () => {
    guards.guild.mockResolvedValue(false);
    const reader = fakeReader();
    const response = await mount(reader).request(`${ROUTE()}?window=7d`);
    expect(response.status).toBe(401);
    expect(reader.summary).not.toHaveBeenCalled();
  });
});
