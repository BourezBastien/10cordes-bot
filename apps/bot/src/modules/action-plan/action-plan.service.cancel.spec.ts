import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, ComponentType, MessageFlags, PermissionsBitField, type GuildMember } from 'discord.js';
import type { BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import type { PermissionName } from '../../core/security/permission-name';
import { ActionPlanService } from './action-plan.service';

/**
 * Clic « Annuler » : seul l'auteur du plan peut l'annuler, une seule fois,
 * et rien n'est jamais exécuté par un clic d'annulation. Le plan est refermé
 * annulé, son panneau montre le résultat, l'auteur reçoit un accusé, et le
 * plan ne peut plus être appliqué.
 */

const GUILD = '1550000000000000001';
const OWNER = '1550000000000000002';
const CHANNEL = '1550000000000000003';
const USER = '1550000000000000004';
const OUTSIDER = '1550000000000000005';
const ROLE = '1550000000000000006';
const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const PLAN = 'plan1';
const MESSAGE = 'msg-1';
const EPHEMERAL_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const CLAIM = { where: { id: PLAN, kind: 'action-plan' }, data: { kind: 'action-plan:locked' } };
const ONLY_AUTHOR = ['🚫 Seul l\'auteur de la demande peut annuler ce plan.'];
const MISSING = ['🚫 Ce plan est introuvable sur ce serveur.'];
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
const orderOf = (mock: { mock: { invocationCallOrder: number[] } }): number => mock.mock.invocationCallOrder[0] as number;
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
function fakeGuild(flags: PermissionName[]) {
  const guild = {
    id: GUILD,
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

/** Clic factice de l'auteur du plan : ses permissions dans le salon, au moment du clic. */
function fakeInteraction(guild: ReturnType<typeof fakeGuild>) {
  return {
    user: { id: USER },
    guild,
    message: { editedTimestamp: null as number | null },
    locale: 'fr',
    memberPermissions: { toArray: () => ['ManageChannels', 'KickMembers', 'ViewChannel'] },
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
  const guild = fakeGuild(flags);
  const interaction = fakeInteraction(guild);
  const service = new ActionPlanService({ interactiveSurface: prisma.surface } as never, audit as never, client as never, registry as never);
  return { ...prisma, audit, registry, service, interaction, fetchMember: guild.members.fetch, fetchMessage, edit };
}

type Harness = ReturnType<typeof harness>;

/** Un plan affiché, obtenu par le vrai chemin : mise en attente, puis fin de demande. Les traces de cet affichage sont oubliées. */
async function postedPlan(h: Harness, actions: Array<readonly [string, Record<string, unknown>]>): Promise<void> {
  for (const [label, input] of actions) h.service.stage(ctxOf(), label, input);
  await h.service.flush(GUILD, USER);
  for (const effect of [h.audit.record, h.surface.update, h.surface.findUnique]) effect.mockClear();
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
const auditActions = (h: Harness): string[] => h.audit.record.mock.calls.map(([row]) => row.action);
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

describe('ActionPlanService · clic « Annuler »', () => {
  it('prend le plan et le referme annulé : rien n\'est rechargé ni exécuté ; panneau remplacé, trace, puis accusé', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }], [STRUCTURAL, { name: 'salon-b' }]]);
    await h.service.cancel(PLAN, h.interaction as never);
    expect(h.surface.updateMany.mock.calls).toEqual([[CLAIM]]);
    expect(h.rows[0].kind).toBe('action-plan:closed');
    expect(JSON.parse(h.rows[0].state)).toMatchObject({ status: 'cancelled', report: { done: 0 } });
    expect(h.fetchMember).not.toHaveBeenCalled();
    expect(h.registry.get).not.toHaveBeenCalled();
    expect(h.registry.run).not.toHaveBeenCalled();
    expect(h.audit.record.mock.calls).toEqual([[auditRow('plan.cancelled', { planId: PLAN, done: 0, total: 2, stoppedAt: undefined, reason: undefined })]]);
    // Prise, acquittement, enregistrement, panneau remplacé, trace, accusé : dans cet ordre.
    expect(orderOf(h.surface.updateMany)).toBeLessThan(orderOf(h.interaction.deferReply));
    expect(orderOf(h.interaction.deferReply)).toBeLessThan(orderOf(h.surface.update));
    expect(orderOf(h.surface.update)).toBeLessThan(orderOf(h.fetchMessage));
    expect(orderOf(h.fetchMessage)).toBeLessThan(orderOf(h.audit.record));
    expect(orderOf(h.audit.record)).toBeLessThan(orderOf(h.interaction.editReply));
    expect(h.fetchMessage.mock.calls).toEqual([[MESSAGE]]);
    expect(h.interaction.deferReply.mock.calls).toEqual([[{ flags: EPHEMERAL_V2 }]]);
    const edited = h.edit.mock.calls[0][0];
    expect(edited.allowedMentions).toEqual({ parse: [] });
    expect(textsOf(edited.components)).toEqual(['## Plan annulé', `Demande de <@${USER}>`, '1. **test.deleteThing** (non exécutée)', '2. **deleteChannel** (non exécutée)', '-# Rien n\'a été exécuté.']);
    expect(buttonIdsOf(edited.components)).toEqual([]);
    expect(h.interaction.editReply.mock.calls).toHaveLength(1);
    expect(textsOf(h.interaction.editReply.mock.calls[0][0].components)).toEqual(['ℹ️ **Plan annulé**\nRien n\'a été exécuté.']);
    expect(h.interaction.reply).not.toHaveBeenCalled();
  });

  it('clic d\'un autre membre : refusé, et l\'auteur peut toujours annuler son plan', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }]]);
    await h.service.cancel(PLAN, { ...h.interaction, user: { id: OUTSIDER } } as never);
    expectRefused(h, ONLY_AUTHOR);
    expectUntouched(h);
    await h.service.cancel(PLAN, h.interaction as never);
    expect(auditActions(h)).toEqual(['plan.cancelled']);
  });

  it('plan introuvable : refus éphémère, rien d\'autre', async () => {
    const h = harness();
    await h.service.cancel('aucun-plan', h.interaction as never);
    expectRefused(h, MISSING);
    expectUntouched(h);
  });

  it.each([
    ['appliqué', 'apply', 1],
    ['annulé', 'cancel', 0],
  ] as const)('un plan déjà %s ne s\'annule plus : refusé, sans nouvel acquittement ni effet', async (_label, first, runs) => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }]]);
    await h.service[first](PLAN, h.interaction as never);
    await h.service.cancel(PLAN, h.interaction as never);
    expect(h.surface.updateMany.mock.calls).toEqual([[CLAIM], [CLAIM]]);
    expect(h.registry.run).toHaveBeenCalledTimes(runs);
    expect(h.interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(h.edit).toHaveBeenCalledTimes(1);
    expect(sentTexts(h)).toEqual([TAKEN]);
  });

  it('un plan annulé ne peut plus être appliqué', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }]]);
    await h.service.cancel(PLAN, h.interaction as never);
    await h.service.apply(PLAN, h.interaction as never);
    expect(h.surface.updateMany.mock.calls).toEqual([[CLAIM], [CLAIM]]);
    expect(h.fetchMember).not.toHaveBeenCalled();
    expect(h.registry.run).not.toHaveBeenCalled();
    expect(sentTexts(h)).toEqual([TAKEN]);
    expect(auditActions(h)).toEqual(['plan.cancelled']);
  });
});
