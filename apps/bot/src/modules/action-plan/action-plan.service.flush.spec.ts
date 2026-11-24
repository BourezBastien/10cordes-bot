import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { ToolRunContext } from '@10cordes/shared';
import { ActionPlanService } from './action-plan.service';
import { PLAN_LIMITS } from './action-plan.types';

/**
 * Fin de demande (flush) quand l'affichage ou la purge ne se passent pas
 * comme prévu. Ce que ces tests fixent : un panneau impossible à afficher
 * annule le plan, le referme et le rend inapplicable ; un salon sorti du
 * cache est relancé par fetch ; la purge des plans expirés précède la
 * création, n'empêche pas le plan quand elle échoue, et ne touche qu'à ce
 * serveur.
 */

const GUILD = '1550000000000000001';
const OTHER_GUILD = '1550000000000000008';
const CHANNEL = '1550000000000000002';
const OTHER_CHANNEL = '1550000000000000007';
const MISSING_CHANNEL = '1550000000000000099';
const USER = '1550000000000000003';
const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const TOOL = 'test.deleteThing';

type Row = { id: string; guildId: string; channelId: string; messageId: string | null; kind: string; definition: string; state: string; createdBy: string };

const ctxOf = (overrides: Partial<ToolRunContext> = {}): ToolRunContext => ({
  guildId: GUILD,
  channelId: CHANNEL,
  userId: USER,
  locale: 'fr',
  permissions: [],
  reply: async () => undefined,
  ...overrides,
});

const action = (target: string) => ({ tool: TOOL, input: { target } });

/** Salon factice : il reçoit le panneau, puis l'édite (fetch du message, puis edit). */
function fakeChannel() {
  return {
    isTextBased: () => true,
    send: vi.fn(async (_payload: unknown) => ({ id: 'msg-1' })),
    messages: { fetch: vi.fn(async (_id: string) => ({ edit: vi.fn(async () => undefined) })) },
  };
}

/** Prisma en mémoire : la table des surfaces interactives, réduite à ce que le store des plans utilise. */
function fakePrisma() {
  const rows: Row[] = [];
  let sequence = 0;
  return {
    rows,
    create: vi.fn(async ({ data }: { data: Omit<Row, 'id' | 'messageId'> }) => {
      const row: Row = { id: `plan${++sequence}`, messageId: null, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = rows.find((entry) => entry.id === where.id);
      if (!row) throw new Error('enregistrement introuvable');
      Object.assign(row, data);
      return row;
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((entry) => entry.id === where.id) ?? null),
    findMany: vi.fn(async ({ where }: { where: { guildId: string; kind: string } }) =>
      rows.filter((entry) => entry.guildId === where.guildId && entry.kind === where.kind),
    ),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; kind: string }; data: Partial<Row> }) => {
      const claimed = rows.filter((entry) => entry.id === where.id && entry.kind === where.kind);
      for (const row of claimed) Object.assign(row, data);
      return { count: claimed.length };
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const index = rows.findIndex((entry) => entry.id === where.id);
      if (index < 0) throw new Error('enregistrement introuvable');
      return rows.splice(index, 1)[0];
    }),
  };
}

function harness() {
  const prisma = fakePrisma();
  const channel = fakeChannel();
  const otherChannel = fakeChannel();
  const client = { channels: { cache: new Map([[CHANNEL, channel], [OTHER_CHANNEL, otherChannel]]), fetch: vi.fn(async (_id: string): Promise<unknown> => null) }, guilds: { cache: new Map() } };
  const audit = { record: vi.fn() };
  const registry = { get: vi.fn(), run: vi.fn() };
  const service = new ActionPlanService({ interactiveSurface: prisma } as never, audit as never, client as never, registry as never);
  return { prisma, registry, channel, otherChannel, client, audit, service };
}

const NOT_SHOWN = { status: 'cancelled', messageId: null, report: { done: 0, reason: 'panneau non affiché' } };
const TAKEN = '🚫 Ce plan a déjà été appliqué, annulé ou a expiré.';

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ActionPlanService · fin de demande : panneau impossible à afficher', () => {
  it('salon introuvable : le plan est annulé « panneau non affiché », refermé sans message', async () => {
    const h = harness();
    h.service.stage(ctxOf({ channelId: MISSING_CHANNEL }), TOOL, { target: 'salon-a' });
    expect(await h.service.flush(GUILD, USER)).toMatchObject(NOT_SHOWN);
    expect(h.client.channels.fetch).toHaveBeenCalledWith(MISSING_CHANNEL);
    expect(h.channel.send).not.toHaveBeenCalled();
    expect(h.prisma.rows[0]).toMatchObject({ kind: 'action-plan:closed', messageId: null });
    expect(h.audit.record).toHaveBeenCalledWith({
      guildId: GUILD,
      source: 'agent',
      action: 'plan.posted',
      actorId: USER,
      metadata: { planId: 'plan1', actions: 1, dropped: 0, summary: false, posted: false },
    });
  });

  it.each([
    ['le salon n\'est plus textuel', (h: ReturnType<typeof harness>) => h.client.channels.cache.set(CHANNEL, { ...h.channel, isTextBased: () => false })],
    ['l\'envoi du panneau échoue', (h: ReturnType<typeof harness>) => h.channel.send.mockRejectedValue(new Error('Missing Access'))],
  ])('%s : annulé « panneau non affiché » de la même façon', async (_label, breakIt) => {
    const h = harness();
    breakIt(h);
    h.service.stage(ctxOf(), TOOL, { target: 'salon-a' });
    expect(await h.service.flush(GUILD, USER)).toMatchObject(NOT_SHOWN);
    expect(h.prisma.rows[0]).toMatchObject({ kind: 'action-plan:closed', messageId: null });
  });

  it('un plan au panneau jamais affiché ne peut pas être appliqué : refusé, rien n\'est exécuté', async () => {
    const h = harness();
    h.client.channels.cache.clear();
    h.service.stage(ctxOf(), TOOL, { target: 'salon-a' });
    const plan = await h.service.flush(GUILD, USER);
    interface Refusal {
      flags: number;
      components: Array<{ toJSON: () => { content?: string } }>;
    }
    const click = { user: { id: USER }, guild: { id: GUILD }, reply: vi.fn(async (_refusal: Refusal) => undefined), deferReply: vi.fn(), editReply: vi.fn() };

    await h.service.apply(plan?.id ?? '', click as never);

    expect(h.prisma.updateMany.mock.calls).toEqual([[{ where: { id: 'plan1', kind: 'action-plan' }, data: { kind: 'action-plan:locked' } }]]);
    expect(click.reply.mock.calls).toHaveLength(1);
    expect(click.reply.mock.calls[0][0].flags).toBe(MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
    expect(click.reply.mock.calls[0][0].components[0].toJSON().content).toBe(TAKEN);
    expect(click.deferReply).not.toHaveBeenCalled();
    expect(h.registry.run).not.toHaveBeenCalled();
    expect(h.channel.send).not.toHaveBeenCalled();
  });

  it('salon sorti du cache : relancé par fetch, le panneau y est affiché', async () => {
    const h = harness();
    h.client.channels.cache.delete(CHANNEL);
    h.client.channels.fetch.mockResolvedValue(h.channel);
    h.service.stage(ctxOf(), TOOL, { target: 'salon-a' });
    expect(await h.service.flush(GUILD, USER)).toMatchObject({ status: 'pending', messageId: 'msg-1' });
    expect(h.client.channels.fetch).toHaveBeenCalledWith(CHANNEL);
    expect(h.channel.send).toHaveBeenCalledTimes(1);
  });
});

describe('ActionPlanService · fin de demande : purge des plans expirés', () => {
  it('l\'échec de la purge n\'empêche pas le plan', async () => {
    const h = harness();
    h.prisma.findMany.mockRejectedValue(new Error('base indisponible'));
    h.service.stage(ctxOf(), TOOL, { target: 'salon-a' });
    expect(await h.service.flush(GUILD, USER)).toMatchObject({ id: 'plan1', status: 'pending', messageId: 'msg-1' });
  });

  it('les plans en attente expirés de ce serveur sont purgés avant la création ; les autres restent', async () => {
    const h = harness();
    const waiting = (id: string, guildId: string, expiresAt: number): Row => ({
      id,
      guildId,
      channelId: CHANNEL,
      messageId: null,
      kind: 'action-plan',
      definition: '{}',
      createdBy: USER,
      state: JSON.stringify({ requesterId: USER, actions: [action('ancien')], status: 'pending', createdAt: T0 - 20 * 60_000, expiresAt, report: null }),
    });
    h.prisma.rows.push(waiting('perime', GUILD, T0), waiting('autre-serveur', OTHER_GUILD, T0), waiting('encore-valide', GUILD, T0 + 1));
    h.prisma.rows.push({ ...waiting('termine', GUILD, T0), kind: 'action-plan:closed' });
    h.service.stage(ctxOf(), TOOL, { target: 'salon-a' });
    await h.service.flush(GUILD, USER);
    expect(h.prisma.rows.map((row) => row.id)).toEqual(['autre-serveur', 'encore-valide', 'termine', 'plan1']);
  });
});

describe('ActionPlanService · fin de demande : plan tenu par ses limites', () => {
  it('tous salons confondus, le plan garde au plus dix actions', async () => {
    const h = harness();
    for (let index = 1; index <= 6; index += 1) {
      h.service.stage(ctxOf(), TOOL, { target: `ici-${index}` });
      h.service.stage(ctxOf({ channelId: OTHER_CHANNEL }), TOOL, { target: `ailleurs-${index}` });
    }
    expect((await h.service.flush(GUILD, USER))?.actions).toHaveLength(PLAN_LIMITS.maxActions);
  });

  it('plan illisible juste après sa création : rien n\'est affiché ni tracé', async () => {
    const h = harness();
    h.prisma.findUnique.mockResolvedValue(null);
    h.service.stage(ctxOf(), TOOL, { target: 'salon-a' });
    await expect(h.service.flush(GUILD, USER)).resolves.toBeNull();
    expect(h.channel.send).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });
});
