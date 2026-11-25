import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentType, MessageFlags } from 'discord.js';
import type { ToolRunContext } from '@10cordes/shared';
import type { PlanAction } from '../../core/security/action-plan.policy';
import { getActionPlans } from './action-plan.runtime';
import { ActionPlanService } from './action-plan.service';
import { PLAN_LIMITS } from './action-plan.types';

/**
 * Plans d'action, de la mise en attente à l'affichage. Ce que ces tests
 * fixent : les actions destructives d'une même demande s'accumulent par
 * demandeur et par salon, dans la limite du plan ; la fin de demande les
 * réunit en UN plan, purgé puis créé, relu, affiché, enregistré et tracé,
 * dans cet ordre. Les échecs de l'affichage et de la purge :
 * action-plan.service.flush.spec.ts.
 */

const GUILD = '1550000000000000001';
const OTHER_GUILD = '1550000000000000008';
const CHANNEL = '1550000000000000002';
const OTHER_CHANNEL = '1550000000000000007';
const USER = '1550000000000000003';
const OTHER_USER = '1550000000000000006';
const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const TOOL = 'test.deleteThing';

type Row = { id: string; guildId: string; channelId: string; messageId: string | null; kind: string; definition: string; state: string; createdBy: string };
interface SentPayload {
  flags?: number;
  content?: unknown;
  components?: unknown[];
  allowedMentions?: unknown;
}

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
const targetsOf = (actions: PlanAction[]): string[] => actions.map((entry) => String(entry.input.target));

/** Salon factice : il reçoit le panneau, puis l'édite (fetch du message, puis edit). */
function fakeChannel() {
  return {
    isTextBased: () => true,
    send: vi.fn(async (_payload: SentPayload) => ({ id: 'msg-1' })),
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
  const client = { channels: { cache: new Map([[CHANNEL, channel], [OTHER_CHANNEL, otherChannel]]), fetch: vi.fn(async () => null) }, guilds: { cache: new Map() } };
  const audit = { record: vi.fn() };
  const service = new ActionPlanService({ interactiveSurface: prisma } as never, audit as never, client as never, { get: vi.fn(), run: vi.fn() } as never, { record: vi.fn() } as never);
  return { prisma, channel, otherChannel, client, audit, service };
}

/** Chaque étape a été appelée, et sa première venue suit celle de l'étape précédente. */
function calledInOrder(steps: Array<{ mock: { invocationCallOrder: number[] } }>): void {
  const ranks = steps.map((step) => step.mock.invocationCallOrder[0]);
  expect(ranks.every((rank) => typeof rank === 'number')).toBe(true);
  expect(ranks).toEqual([...ranks].sort((left, right) => Number(left) - Number(right)));
  expect(new Set(ranks).size).toBe(ranks.length);
}

interface Node {
  type?: number;
  content?: string;
  custom_id?: string;
  components?: Node[];
}

/** Composants sérialisés, à plat, dans l'ordre du payload. */
function flat(components: unknown): Node[] {
  const walk = (nodes: Node[]): Node[] => nodes.flatMap((node) => [node, ...walk(node.components ?? [])]);
  return walk(JSON.parse(JSON.stringify(components)) as Node[]);
}

const textsOf = (components: unknown): string[] =>
  flat(components).filter((node) => node.type === ComponentType.TextDisplay).map((node) => node.content ?? '');
const buttonIdsOf = (components: unknown): string[] =>
  flat(components).filter((node) => node.type === ComponentType.Button).map((node) => node.custom_id ?? '');

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ActionPlanService · mise en attente (stage)', () => {
  it('null sans serveur ni salon : rien n\'attend, la fin de demande ne crée rien', async () => {
    const h = harness();
    expect(h.service.stage(ctxOf({ guildId: null }), TOOL, { target: 'a' })).toBeNull();
    expect(h.service.stage(ctxOf({ channelId: null }), TOOL, { target: 'b' })).toBeNull();
    expect(h.service.stage(ctxOf({ channelId: undefined }), TOOL, { target: 'c' })).toBeNull();
    await expect(h.service.flush(GUILD, USER)).resolves.toBeNull();
    expect(h.prisma.create).not.toHaveBeenCalled();
  });

  it('les actions d\'une même demande s\'accumulent dans leur ordre d\'arrivée, comptées une à une', async () => {
    const h = harness();
    expect(h.service.stage(ctxOf(), TOOL, { target: 'salon-a' })).toEqual({ count: 1, full: false });
    expect(h.service.stage(ctxOf(), TOOL, { target: 'salon-b' })).toEqual({ count: 2, full: false });
    expect((await h.service.flush(GUILD, USER))?.actions).toEqual([action('salon-a'), action('salon-b')]);
  });

  it('rien ne se mélange entre demandeurs, entre salons ni entre serveurs', async () => {
    const h = harness();
    h.service.stage(ctxOf(), TOOL, { target: 'moi' });
    expect(h.service.stage(ctxOf({ userId: OTHER_USER }), TOOL, { target: 'autre' })).toEqual({ count: 1, full: false });
    expect(h.service.stage(ctxOf({ channelId: OTHER_CHANNEL }), TOOL, { target: 'ailleurs' })).toEqual({ count: 1, full: false });
    expect(h.service.stage(ctxOf({ guildId: OTHER_GUILD }), TOOL, { target: 'autre-serveur' })).toEqual({ count: 1, full: false });
    expect(targetsOf((await h.service.flush(GUILD, USER))?.actions ?? [])).toEqual(['moi', 'ailleurs']);
    expect(targetsOf((await h.service.flush(GUILD, OTHER_USER))?.actions ?? [])).toEqual(['autre']);
    expect(targetsOf((await h.service.flush(OTHER_GUILD, USER))?.actions ?? [])).toEqual(['autre-serveur']);
  });

  it('onzième action : le plan est plein, elle est comptée mais pas ajoutée', async () => {
    const h = harness();
    for (let index = 1; index <= PLAN_LIMITS.maxActions; index += 1) {
      expect(h.service.stage(ctxOf(), TOOL, { target: `salon-${index}` })).toEqual({ count: index, full: false });
    }
    expect(h.service.stage(ctxOf(), TOOL, { target: 'salon-de-trop' })).toEqual({ count: PLAN_LIMITS.maxActions, full: true });
    const plan = await h.service.flush(GUILD, USER);
    expect(plan?.actions).toHaveLength(PLAN_LIMITS.maxActions);
    expect(targetsOf(plan?.actions ?? [])).not.toContain('salon-de-trop');
  });

  it('à plus de dix minutes d\'écart, les actions ne se regroupent plus : les anciennes sont laissées', async () => {
    const h = harness();
    h.service.stage(ctxOf(), TOOL, { target: 'a' });
    vi.setSystemTime(T0 + 9 * 60_000);
    expect(h.service.stage(ctxOf(), TOOL, { target: 'b' })).toEqual({ count: 2, full: false });
    vi.setSystemTime(T0 + 18 * 60_000);
    expect(h.service.stage(ctxOf(), TOOL, { target: 'c' })).toEqual({ count: 3, full: false });
    vi.setSystemTime(T0 + 28 * 60_000);
    expect(h.service.stage(ctxOf(), TOOL, { target: 'd' })).toEqual({ count: 1, full: false });
    expect(targetsOf((await h.service.flush(GUILD, USER))?.actions ?? [])).toEqual(['d']);
  });
});

describe('ActionPlanService · fin de demande (flush)', () => {
  it('sans action en attente : null, rien n\'est écrit, affiché ni tracé', async () => {
    const h = harness();
    await expect(h.service.flush(GUILD, USER)).resolves.toBeNull();
    expect(h.prisma.findMany).not.toHaveBeenCalled();
    expect(h.prisma.create).not.toHaveBeenCalled();
    expect(h.channel.send).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it('UN plan pour toute la demande : purgé, créé, relu, affiché, enregistré, puis tracé, dans cet ordre', async () => {
    const h = harness();
    h.service.stage(ctxOf(), TOOL, { target: 'salon-a' });
    h.service.stage(ctxOf(), TOOL, { target: 'salon-b' });
    expect(await h.service.flush(GUILD, USER)).toEqual({
      id: 'plan1',
      guildId: GUILD,
      channelId: CHANNEL,
      requesterId: USER,
      messageId: 'msg-1',
      actions: [action('salon-a'), action('salon-b')],
      summary: null,
      dropped: [],
      status: 'pending',
      createdAt: T0,
      expiresAt: T0 + PLAN_LIMITS.lifetimeMs,
      report: null,
    });
    calledInOrder([h.prisma.findMany, h.prisma.create, h.prisma.findUnique, h.channel.send, h.prisma.update, h.audit.record]);
    expect(h.prisma.rows).toHaveLength(1);
    expect(h.prisma.rows[0]).toMatchObject({ kind: 'action-plan', messageId: 'msg-1' });
    expect(h.prisma.update).toHaveBeenCalledWith({
      where: { id: 'plan1' },
      data: { kind: 'action-plan', messageId: 'msg-1', state: expect.any(String) },
      select: { id: true },
    });
    expect(h.audit.record).toHaveBeenCalledTimes(1);
    expect(h.audit.record).toHaveBeenCalledWith({
      guildId: GUILD,
      source: 'agent',
      action: 'plan.posted',
      actorId: USER,
      metadata: { planId: 'plan1', actions: 2, dropped: 0, summary: false, posted: true },
    });
  });

  it('le panneau est posté sans mention possible, et ses boutons portent l\'identifiant du plan stocké', async () => {
    const h = harness();
    h.service.stage(ctxOf(), TOOL, { target: 'salon-a' });
    await h.service.flush(GUILD, USER);
    expect(h.channel.send).toHaveBeenCalledTimes(1);
    const payload = h.channel.send.mock.calls[0][0];
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(payload.content).toBeUndefined();
    expect(textsOf(payload.components)).toEqual([
      '## Confirmer les actions (hors lecture)',
      `Demande de <@${USER}> · Expire <t:${(T0 + PLAN_LIMITS.lifetimeMs) / 1000}:R>`,
      `1. **${TOOL}** · target=salon-a`,
      expect.stringContaining('Seul l\'auteur de la demande'),
    ]);
    expect(buttonIdsOf(payload.components)).toEqual(['plan:apply~p=plan1', 'plan:cancel~p=plan1']);
  });

  it('une fois affiché, plus rien n\'attend : une seconde fin de demande n\'affiche rien', async () => {
    const h = harness();
    h.service.stage(ctxOf(), TOOL, { target: 'salon-a' });
    await h.service.flush(GUILD, USER);
    await expect(h.service.flush(GUILD, USER)).resolves.toBeNull();
    expect(h.channel.send).toHaveBeenCalledTimes(1);
    expect(h.prisma.create).toHaveBeenCalledTimes(1);
  });

  it('tous les salons de la demande forment un seul plan, affiché une seule fois, dans le salon qu\'il désigne', async () => {
    const h = harness();
    h.service.stage(ctxOf(), TOOL, { target: 'ici-1' });
    h.service.stage(ctxOf({ channelId: OTHER_CHANNEL }), TOOL, { target: 'ailleurs' });
    h.service.stage(ctxOf(), TOOL, { target: 'ici-2' });
    const plan = await h.service.flush(GUILD, USER);
    const targets = targetsOf(plan?.actions ?? []);
    expect(targets).toHaveLength(3);
    expect([...targets].sort()).toEqual(['ailleurs', 'ici-1', 'ici-2']);
    // Dans un même salon, l'ordre de proposition est conservé.
    expect(targets.indexOf('ici-1')).toBeLessThan(targets.indexOf('ici-2'));
    const painted = [h.channel, h.otherChannel].filter((channel) => channel.send.mock.calls.length === 1);
    expect(painted).toHaveLength(1);
    expect(h.client.channels.cache.get(plan?.channelId ?? '')).toBe(painted[0]);
    await expect(h.service.flush(GUILD, USER)).resolves.toBeNull();
  });
});

describe('ActionPlanService · démarrage', () => {
  it('onBoot lie le service à l\'accesseur runtime que la porte du registry consulte', () => {
    expect(getActionPlans()).toBeNull();
    const h = harness();
    h.service.onBoot();
    expect(getActionPlans()).toBe(h.service);
  });
});
