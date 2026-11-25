import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, ComponentType, MessageFlags, PermissionsBitField, type GuildMember } from 'discord.js';
import type { BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import type { PermissionName } from '../../core/security/permission-name';
import { ActionPlanService } from './action-plan.service';
import { PLAN_LIMITS } from './action-plan.types';

/**
 * Clic « Appliquer » : ce qui arrête un plan AVANT sa première exécution.
 * Panneau d'approbation modifié, ou délai dépassé : le clic est acquitté,
 * le plan est refermé (annulé ou expiré) sans recharger le demandeur ni
 * exécuter ni photographier quoi que ce soit, son panneau montre le résultat
 * et l'auteur du clic reçoit un accusé. Les arrêts au cours de l'exécution :
 * action-plan.service.stops.spec.ts.
 */

const GUILD = '1550000000000000001';
const OWNER = '1550000000000000002';
const CHANNEL = '1550000000000000003';
const USER = '1550000000000000004';
const ROLE = '1550000000000000006';
const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const PLAN = 'plan1';
const MESSAGE = 'msg-1';
const EPHEMERAL_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const CLAIM = { where: { id: PLAN, kind: 'action-plan' }, data: { kind: 'action-plan:locked' } };

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
  const service = new ActionPlanService({ interactiveSurface: prisma.surface } as never, audit as never, client as never, registry as never, { record: vi.fn() } as never);
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

/** Un plan arrêté : pris puis refermé dans cet état, panneau remplacé par ce résultat (sans boutons), trace finale, accusé éphémère. */
function expectStopped(h: Harness, outcome: { status: string; report: unknown; panel: string[]; receipt: string; audit: ReturnType<typeof auditRow> }): void {
  expect(h.surface.updateMany.mock.calls).toEqual([[CLAIM]]);
  expect(h.rows[0].kind).toBe('action-plan:closed');
  expect(JSON.parse(h.rows[0].state)).toMatchObject({ status: outcome.status, report: outcome.report });
  expect(h.interaction.deferReply.mock.calls).toEqual([[{ flags: EPHEMERAL_V2 }]]);
  expect(h.fetchMessage.mock.calls).toEqual([[MESSAGE]]);
  const edited = h.edit.mock.calls[0][0];
  expect(textsOf(edited.components)).toEqual(outcome.panel);
  expect(buttonIdsOf(edited.components)).toEqual([]);
  expect(h.audit.record.mock.calls.at(-1)).toEqual([outcome.audit]);
  expect(h.interaction.editReply.mock.calls).toHaveLength(1);
  expect(textsOf(h.interaction.editReply.mock.calls[0][0].components)).toEqual([outcome.receipt]);
  expect(h.interaction.reply).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ActionPlanService · clic « Appliquer » : arrêts avant toute exécution', () => {
  const MODIFIED = 'message d\'approbation modifié';
  const LATE = 'délai d\'approbation dépassé';
  const LATE_FOOTER = 'Le délai d\'approbation est dépassé, rien n\'a été exécuté.';

  it('panneau d\'approbation modifié avant le clic : annulé, rien n\'est rechargé, photographié ni exécuté', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }], [STRUCTURAL, { name: 'salon-b' }]]);
    h.interaction.message.editedTimestamp = T0 + 1_000;
    await h.service.apply(PLAN, h.interaction as never);
    expectStopped(h, {
      status: 'cancelled',
      report: { done: 0, reason: MODIFIED },
      panel: ['## Plan annulé', `Demande de <@${USER}>`, '1. **test.deleteThing** (non exécutée)', '2. **deleteChannel** (non exécutée)', '-# Rien n\'a été exécuté.'],
      receipt: 'ℹ️ **Plan annulé**\nRien n\'a été exécuté.',
      audit: auditRow('plan.cancelled', { planId: PLAN, done: 0, total: 2, stoppedAt: undefined, reason: MODIFIED }),
    });
    expect(h.fetchMember).not.toHaveBeenCalled();
    expect(h.registry.run).not.toHaveBeenCalled();
    expect(auditActions(h)).toEqual(['plan.cancelled']);
  });

  it('délai dépassé dès l\'instant exact de l\'expiration : expiré, rien n\'est rechargé ni exécuté', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }]]);
    vi.setSystemTime(T0 + PLAN_LIMITS.lifetimeMs);
    await h.service.apply(PLAN, h.interaction as never);
    expectStopped(h, {
      status: 'expired',
      report: { done: 0, reason: LATE },
      panel: ['## Plan expiré', `Demande de <@${USER}>`, '1. **test.deleteThing** (non exécutée)', `-# ${LATE_FOOTER}`],
      receipt: `⚠️ **Plan expiré**\n${LATE_FOOTER}`,
      audit: auditRow('plan.expired', { planId: PLAN, done: 0, total: 1, stoppedAt: undefined, reason: LATE }),
    });
    expect(h.fetchMember).not.toHaveBeenCalled();
    expect(h.registry.run).not.toHaveBeenCalled();
  });

  it('une milliseconde avant l\'expiration, le plan s\'applique encore', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }]]);
    vi.setSystemTime(T0 + PLAN_LIMITS.lifetimeMs - 1);
    await h.service.apply(PLAN, h.interaction as never);
    expect(h.registry.run).toHaveBeenCalledTimes(1);
    expect(auditActions(h)).toEqual(['plan.action', 'plan.executed']);
  });

  it('panneau modifié ET délai dépassé : c\'est l\'annulation qui est retenue', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }]]);
    h.interaction.message.editedTimestamp = T0 + 1_000;
    vi.setSystemTime(T0 + PLAN_LIMITS.lifetimeMs);
    await h.service.apply(PLAN, h.interaction as never);
    expect(JSON.parse(h.rows[0].state)).toMatchObject({ status: 'cancelled', report: { done: 0, reason: MODIFIED } });
    expect(auditActions(h)).toEqual(['plan.cancelled']);
  });
});
