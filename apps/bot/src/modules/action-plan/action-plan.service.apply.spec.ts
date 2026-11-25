import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, ComponentType, MessageFlags, PermissionsBitField, type GuildMember } from 'discord.js';
import type { BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import type { PermissionName } from '../../core/security/permission-name';
import { ActionPlanService } from './action-plan.service';
import { PLAN_IDS, planButtonId, type ActionPlan } from './action-plan.types';

/**
 * Clic « Appliquer » : refus, prise du plan et exécution. Un plan ne se
 * prend qu'une fois, par son auteur, dans son serveur. Une fois pris : clic
 * acquitté, demandeur rechargé, actions exécutées dans l'ordre sous
 * l'identité du demandeur, instantané du serveur avant la première action
 * structurelle, panneau devenu résultat, tout tracé. Les arrêts de
 * l'exécution : action-plan.service.stops.spec.ts.
 */

const GUILD = '1550000000000000001';
const OWNER = '1550000000000000002';
const CHANNEL = '1550000000000000003';
const USER = '1550000000000000004';
const OUTSIDER = '1550000000000000005';
const ROLE = '1550000000000000006';
const OTHER_GUILD = '1550000000000000009';
const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const PLAN = 'plan1';
const MESSAGE = 'msg-1';
const EPHEMERAL_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const CLAIM = { where: { id: PLAN, kind: 'action-plan' }, data: { kind: 'action-plan:locked' } };
const LOST = ['🚫 Ce plan est introuvable sur ce serveur.'];
const TAKEN = ['🚫 Ce plan a déjà été appliqué, annulé ou a expiré.'];

/** Outils de test : un fictif sans condition, un structurel réel (instantané du serveur requis). */
const CALM = 'test.deleteThing';
const STRUCTURAL = 'deleteChannel';
// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';
const TOOLS: Record<string, BotTool> = {
  [CALM]: { [NAME]: CALM, permissions: [] } as unknown as BotTool,
  [STRUCTURAL]: { [NAME]: STRUCTURAL, permissions: ['ManageChannels'] } as unknown as BotTool,
};

type Row = { id: string; guildId: string; channelId: string; messageId: string | null; kind: string; definition: string; state: string; createdBy: string };
type Payload = { flags?: number; components?: unknown; allowedMentions?: unknown };
/** Rang de la n-ième venue d'une doublure : croissant entre deux doublures, donc comparable. */
const orderOf = (mock: { mock: { invocationCallOrder: number[] } }, call = 0): number => mock.mock.invocationCallOrder[call] as number;
/** Contexte de la demande d'origine : le demandeur, à l'instant où le modèle a proposé l'action. */
const ctxOf = (): ToolRunContext => ({ guildId: GUILD, channelId: CHANNEL, userId: USER, locale: 'en-US', permissions: ['ManageChannels', 'KickMembers'], reply: async () => undefined });

/** Prisma en mémoire : la table des surfaces interactives, réduite à ce que le store des plans utilise. */
function fakePrisma() {
  const rows: Row[] = [];
  let sequence = 0;
  const ofId = (id: string): Row => {
    const row = rows.find((entry) => entry.id === id);
    if (!row) throw new Error('enregistrement introuvable');
    return row;
  };
  const surface = {
    create: vi.fn(async ({ data }: { data: Omit<Row, 'id' | 'messageId'> }) => {
      const row: Row = { id: `plan${++sequence}`, messageId: null, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(ofId(where.id), data)),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((entry) => entry.id === where.id) ?? null),
    findMany: vi.fn(async () => [] as Row[]),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; kind: string }; data: Partial<Row> }) => {
      const claimed = rows.filter((entry) => entry.id === where.id && entry.kind === where.kind);
      for (const row of claimed) Object.assign(row, data);
      return { count: claimed.length };
    }),
  };
  return { rows, surface };
}

/** Serveur factice ; le demandeur y est rechargé (members.fetch) avec les permissions données. */
function fakeGuild(id: string = GUILD, flags: PermissionName[] = ['ManageChannels', 'KickMembers']) {
  const guild = {
    id,
    ownerId: OWNER,
    members: { cache: new Collection<string, GuildMember>(), fetch: vi.fn() },
    roles: { cache: new Collection<string, unknown>() },
    channels: { cache: new Collection<string, unknown>() },
  };
  guild.members.fetch.mockResolvedValue({
    id: USER,
    guild,
    permissions: new PermissionsBitField(flags),
    roles: { cache: new Collection<string, unknown>([[ROLE, { id: ROLE }]]), highest: { position: 5 } },
    isCommunicationDisabled: () => false,
  } as unknown as GuildMember);
  return guild;
}
type FakeGuild = ReturnType<typeof fakeGuild>;

/** Clic factice de l'auteur du plan : ses permissions dans le salon, au moment du clic. */
function fakeInteraction(guild: FakeGuild | null) {
  return {
    id: 'interaction-9',
    customId: planButtonId(PLAN_IDS.apply, PLAN),
    user: { id: USER },
    guild,
    message: { editedTimestamp: null as number | null },
    locale: 'fr',
    memberPermissions: { toArray: () => ['ManageChannels', 'KickMembers', 'ViewChannel'] },
    replied: false,
    deferred: false,
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

function harness(flags: PermissionName[] = ['ManageChannels', 'KickMembers']) {
  const prisma = fakePrisma();
  const edit = vi.fn(async (_payload: Payload) => undefined);
  const fetchMessage = vi.fn(async (_id: string) => ({ edit }));
  const channel = { isTextBased: () => true, send: vi.fn(async (_payload: Payload) => ({ id: MESSAGE })), messages: { fetch: fetchMessage } };
  const client = { channels: { cache: new Map([[CHANNEL, channel]]), fetch: vi.fn(async (_id: string): Promise<unknown> => null) }, guilds: { cache: new Map() } };
  const audit = { record: vi.fn() };
  const registry = {
    get: vi.fn((label: string): BotTool | undefined => TOOLS[label]),
    run: vi.fn(async (_name: string, _input: Record<string, unknown>, _ctx: ToolRunContext, _options: unknown): Promise<ToolResult> => ({ ok: true, summary: 'fait' })),
  };
  const guild = fakeGuild(GUILD, flags);
  const interaction = fakeInteraction(guild);
  const service = new ActionPlanService({ interactiveSurface: prisma.surface } as never, audit as never, client as never, registry as never, { record: vi.fn() } as never);
  return { ...prisma, client, audit, registry, service, interaction, fetchMember: guild.members.fetch, fetchMessage, edit };
}

type Harness = ReturnType<typeof harness>;

/** Un plan affiché, obtenu par le vrai chemin : mise en attente, puis fin de demande. Les traces de cet affichage sont oubliées. */
async function postedPlan(h: Harness, actions: Array<readonly [string, Record<string, unknown>]>): Promise<ActionPlan> {
  for (const [label, input] of actions) h.service.stage(ctxOf(), label, input);
  const plan = await h.service.flush(GUILD, USER);
  if (!plan) throw new Error('le plan n\'a pas été créé');
  for (const effect of [h.audit.record, h.surface.update, h.surface.findUnique]) effect.mockClear();
  return plan;
}

type Node = { type?: number; content?: string; custom_id?: string; components?: Node[] };

/** Composants sérialisés, à plat, dans l'ordre du payload. */
function flat(components: unknown): Node[] {
  const walk = (nodes: Node[]): Node[] => nodes.flatMap((node) => [node, ...walk(node.components ?? [])]);
  return walk(JSON.parse(JSON.stringify(components ?? [])) as Node[]);
}

const textsOf = (components: unknown): string[] => flat(components).filter((node) => node.type === ComponentType.TextDisplay).map((node) => node.content ?? '');
const buttonIdsOf = (components: unknown): string[] => flat(components).filter((node) => node.type === ComponentType.Button).map((node) => node.custom_id ?? '');
const auditRow = (action: string, metadata: Record<string, unknown>) => ({ guildId: GUILD, source: 'agent', action, actorId: USER, metadata });
const sentTexts = (h: Harness): string[][] => h.interaction.reply.mock.calls.map(([call]) => textsOf((call as Payload).components));

/** Refus éphémère du clic : un seul message en reply, portant ce texte, et rien d'autre. */
function expectRefused(h: Harness, texts: string[]): void {
  expect(h.interaction.reply.mock.calls).toEqual([[{ flags: EPHEMERAL_V2, components: [expect.any(Object)] }]]);
  expect(sentTexts(h)).toEqual([texts]);
}

/** Rien d'autre : pas d'acquittement, de prise, de sauvegarde, de rechargement, d'exécution, de panneau touché, ni de trace. */
function expectUntouched(h: Harness): void {
  for (const effect of [h.interaction.deferReply, h.interaction.editReply, h.surface.updateMany, h.surface.update, h.fetchMember, h.registry.run, h.fetchMessage, h.audit.record]) {
    expect(effect).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ActionPlanService · clic « Appliquer » : refus', () => {
  it('plan introuvable : refus éphémère, rien d\'autre', async () => {
    const h = harness();
    await h.service.apply('aucun-plan', h.interaction as never);
    expectRefused(h, LOST);
    expectUntouched(h);
  });

  it('clic depuis un autre serveur, ou hors serveur : même refus, le plan reste en attente et affiché', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }]]);
    const elsewhere = fakeGuild(OTHER_GUILD);
    await h.service.apply(PLAN, { ...h.interaction, guild: elsewhere } as never);
    await h.service.apply(PLAN, { ...h.interaction, guild: null } as never);
    expect(h.interaction.reply.mock.calls.map(([call]) => (call as Payload).flags)).toEqual([EPHEMERAL_V2, EPHEMERAL_V2]);
    expect(sentTexts(h)).toEqual([LOST, LOST]);
    expect(elsewhere.members.fetch).not.toHaveBeenCalled();
    expectUntouched(h);
    expect(h.rows[0]).toMatchObject({ kind: 'action-plan', messageId: MESSAGE });
  });

  it('clic d\'un autre membre : refusé, et l\'auteur peut toujours appliquer son plan', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }]]);
    await h.service.apply(PLAN, { ...h.interaction, user: { id: OUTSIDER } } as never);
    expectRefused(h, ['🚫 Seul l\'auteur de la demande peut appliquer ce plan.']);
    expectUntouched(h);
    await h.service.apply(PLAN, h.interaction as never);
    expect(h.registry.run).toHaveBeenCalledTimes(1);
  });

  it('second clic sur un plan pris : refusé, sans nouvel acquittement ni réexécution', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }]]);
    await h.service.apply(PLAN, h.interaction as never);
    await h.service.apply(PLAN, h.interaction as never);
    expect(h.surface.updateMany.mock.calls).toEqual([[CLAIM], [CLAIM]]);
    expect(h.registry.run).toHaveBeenCalledTimes(1);
    expect(h.interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(h.edit).toHaveBeenCalledTimes(1);
    expect(sentTexts(h)).toEqual([TAKEN]);
  });
});

describe('ActionPlanService · clic « Appliquer » : exécution', () => {
  it('prend le plan, acquitte, recharge le demandeur, exécute dans l\'ordre, referme le panneau, trace, puis accuse', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }], [CALM, { target: 'salon-b' }]]);
    const atRun: number[][] = [];
    h.registry.run.mockImplementation(async (_name, input) => {
      // Au moment d'exécuter : le clic est acquitté, le demandeur rechargé.
      atRun.push([h.interaction.deferReply.mock.calls.length, h.fetchMember.mock.calls.length]);
      return { ok: true, summary: `fait ${String(input.target)}` };
    });

    await h.service.apply(PLAN, h.interaction as never);

    expect(atRun).toEqual([[1, 1], [1, 1]]);
    expect(h.surface.updateMany.mock.calls).toEqual([[CLAIM]]);
    expect(h.interaction.deferReply.mock.calls).toEqual([[{ flags: EPHEMERAL_V2 }]]);
    expect(h.fetchMember.mock.calls).toEqual([[{ user: USER, force: true }]]);
    expect(h.registry.run.mock.calls.map(([name, input]) => [name, input])).toEqual([[CALM, { target: 'salon-a' }], [CALM, { target: 'salon-b' }]]);
    expect(h.rows[0]).toMatchObject({ kind: 'action-plan:closed', messageId: MESSAGE });
    expect(JSON.parse(h.rows[0].state).report).toEqual({ done: 2 });
    expect(h.audit.record.mock.calls).toEqual([
      [auditRow('plan.action', { planId: PLAN, tool: CALM, ok: true, summary: 'fait salon-a' })],
      [auditRow('plan.action', { planId: PLAN, tool: CALM, ok: true, summary: 'fait salon-b' })],
      [auditRow('plan.executed', { planId: PLAN, done: 2, total: 2, stoppedAt: undefined, reason: undefined })],
    ]);
    // Dernière exécution, puis enregistrement, panneau remplacé, trace, et enfin l'accusé.
    expect(orderOf(h.registry.run, 1)).toBeLessThan(orderOf(h.surface.update));
    expect(orderOf(h.surface.update)).toBeLessThan(orderOf(h.fetchMessage));
    expect(orderOf(h.fetchMessage)).toBeLessThan(orderOf(h.audit.record, 2));
    expect(orderOf(h.audit.record, 2)).toBeLessThan(orderOf(h.interaction.editReply));
    expect(h.fetchMessage.mock.calls).toEqual([[MESSAGE]]);
    const edited = h.edit.mock.calls[0][0];
    expect(edited.allowedMentions).toEqual({ parse: [] });
    expect(textsOf(edited.components)).toEqual(['## Plan exécuté', `Demande de <@${USER}>`, '✅ 1. **test.deleteThing**', '✅ 2. **test.deleteThing**', '-# 2 action(s) exécutée(s).']);
    expect(buttonIdsOf(edited.components)).toEqual([]);
    expect(h.interaction.editReply.mock.calls).toEqual([[{ flags: EPHEMERAL_V2, components: [expect.any(Object)] }]]);
    expect(textsOf(h.interaction.editReply.mock.calls[0][0].components)).toEqual(['✅ **Plan exécuté**\n2 action(s) exécutée(s).']);
    expect(h.interaction.reply).not.toHaveBeenCalled();
  });

  it('chaque action s\'exécute sous l\'identité du demandeur RECHARGÉ au clic, jamais sous celle de la demande d\'origine', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }]]);
    await h.service.apply(PLAN, h.interaction as never);
    const [, , context, options] = h.registry.run.mock.calls[0];
    expect(context).toEqual({
      guildId: GUILD,
      channelId: CHANNEL,
      userId: USER,
      locale: 'fr',
      permissions: ['ManageChannels', 'KickMembers', 'ViewChannel'],
      roleIds: [ROLE],
      // Le plan est approuvé : l'autorisation suit le contexte de chaque action, et de ce qu'elle déclenche.
      approvedBy: PLAN,
      reply: expect.any(Function),
    });
    expect(options).toEqual({ approvedBy: PLAN });
    // Répondre depuis une action du plan n'écrit rien dans le salon : seul le panneau y a été posté.
    await expect(context.reply('message')).resolves.toBeUndefined();
    expect(h.client.channels.cache.get(CHANNEL)?.send).toHaveBeenCalledTimes(1);
  });

  it('une action structurelle photographie le serveur AVANT la première exécution, au nom du plan', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }], [STRUCTURAL, { name: 'salon-b' }]]);
    const auditedAtRun: string[][] = [];
    h.registry.run.mockImplementation(async () => {
      auditedAtRun.push(h.audit.record.mock.calls.map(([row]) => row.action));
      return { ok: true, summary: 'fait' };
    });

    await h.service.apply(PLAN, h.interaction as never);

    expect(auditedAtRun).toEqual([['server.snapshot'], ['server.snapshot', 'plan.action']]);
    expect(h.audit.record.mock.calls[0]).toEqual([
      auditRow('server.snapshot', { requestId: `plan:${PLAN}`, snapshot: { at: expect.any(String), categories: [], channels: [], roles: [] } }),
    ]);
    expect(h.audit.record.mock.calls.map(([row]) => row.action)).toEqual(['server.snapshot', 'plan.action', 'plan.action', 'plan.executed']);
  });
});
