import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, ComponentType, MessageFlags, PermissionsBitField, type GuildMember } from 'discord.js';
import type { BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import type { PermissionName } from '../../core/security/permission-name';
import { ActionPlanService } from './action-plan.service';

/**
 * Clic « Appliquer » : ce qui arrête un plan AU COURS de son exécution.
 * Demandeur disparu, action refusée par la revalidation du clic, action qui
 * échoue, outil inconnu : rien ne court après ce qui l'a stoppé. Le plan est
 * refermé interrompu, son panneau montre le résultat et l'auteur du clic
 * reçoit un accusé. Un échec imprévu ne laisse jamais le clic sans réponse.
 * Les arrêts avant toute exécution : action-plan.service.preflight.spec.ts.
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

/** Outils de test : deux fictifs (l'un exige KickMembers), un structurel réel (instantané du serveur requis). */
const CALM = 'test.deleteThing';
const STRICT = 'test.kickThing';
const STRUCTURAL = 'deleteChannel';
// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';
const TOOLS: Record<string, BotTool> = {
  [CALM]: { [NAME]: CALM, permissions: [] } as unknown as BotTool,
  [STRICT]: { [NAME]: STRICT, permissions: ['KickMembers'] } as unknown as BotTool,
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
  const client = { channels: { cache: new Map([[CHANNEL, channel]]), fetch: vi.fn(async (_id: string): Promise<unknown> => null) } };
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

/** Un plan arrêté : pris puis refermé dans cet état, panneau remplacé par ce résultat (sans boutons), trace finale, accusé éphémère. */
function expectStopped(h: Harness, outcome: { status: string; report: unknown; panel: unknown[]; receipt: unknown; audit: ReturnType<typeof auditRow> }): void {
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

describe('ActionPlanService · clic « Appliquer » : arrêts au cours de l\'exécution', () => {
  it.each([
    ['a quitté le serveur', (h: Harness) => h.fetchMember.mockResolvedValue(null)],
    ['est illisible (rechargement en erreur)', (h: Harness) => h.fetchMember.mockRejectedValue(new Error('Discord Down'))],
  ])('le demandeur %s : interrompu avant toute revalidation, exécution ou photographie', async (_label, lose) => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }], [STRUCTURAL, { name: 'salon-b' }]]);
    lose(h);
    await h.service.apply(PLAN, h.interaction as never);
    const GONE = 'membre introuvable sur ce serveur';
    // Sans action coupable, le pied et l'accusé portent la raison ; leur formule exacte n'est pas figée ici.
    expectStopped(h, {
      status: 'interrupted',
      report: { done: 0, reason: GONE },
      panel: ['## Plan interrompu', `Demande de <@${USER}>`, `❌ 1. **${CALM}** : ${GONE}`, `2. **${STRUCTURAL}**`, expect.stringContaining(GONE)],
      receipt: expect.stringMatching(new RegExp(`Plan interrompu[^]*${GONE}`, 'u')),
      audit: auditRow('plan.interrupted', { planId: PLAN, done: 0, total: 2, stoppedAt: undefined, reason: GONE }),
    });
    expect(h.registry.get).not.toHaveBeenCalled();
    expect(h.registry.run).not.toHaveBeenCalled();
    expect(auditActions(h)).toEqual(['plan.interrupted']);
  });

  it('permission retirée au demandeur entre la demande et le clic : interrompu à cette action, les suivantes ne courent pas', async () => {
    const h = harness(['ManageChannels']);
    await postedPlan(h, [[CALM, { target: 'salon-a' }], [STRICT, { target: 'salon-b' }], [CALM, { target: 'salon-c' }]]);
    await h.service.apply(PLAN, h.interaction as never);
    const DENIED = 'permission requise : KickMembers';
    expect(h.registry.run.mock.calls.map(([, input]) => input.target)).toEqual(['salon-a']);
    expectStopped(h, {
      status: 'interrupted',
      report: { done: 1, stoppedAt: STRICT, reason: DENIED },
      panel: ['## Plan interrompu', `Demande de <@${USER}>`, `✅ 1. **${CALM}**`, `❌ 2. **${STRICT}** : ${DENIED}`, `3. **${CALM}**`, `-# 1/3 action(s) exécutée(s). Arrêt sur ${STRICT} : ${DENIED}`],
      receipt: `⚠️ **Plan interrompu**\n1/3 action(s) exécutée(s). Arrêt sur ${STRICT} : ${DENIED}`,
      audit: auditRow('plan.interrupted', { planId: PLAN, done: 1, total: 3, stoppedAt: STRICT, reason: DENIED }),
    });
    expect(auditActions(h)).toEqual(['plan.action', 'plan.interrupted']);
  });

  it('action qui échoue : interrompu sur elle avec sa raison, les suivantes ne courent pas, l\'échec est tracé', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }], [CALM, { target: 'salon-b' }], [CALM, { target: 'salon-c' }]]);
    h.registry.run.mockImplementation(async (_name, input) => (input.target === 'salon-b' ? { ok: false, summary: 'Salon introuvable' } : { ok: true, summary: 'fait' }));
    await h.service.apply(PLAN, h.interaction as never);
    expect(h.registry.run.mock.calls.map(([, input]) => input.target)).toEqual(['salon-a', 'salon-b']);
    expectStopped(h, {
      status: 'interrupted',
      report: { done: 1, stoppedAt: CALM, reason: 'Salon introuvable' },
      panel: ['## Plan interrompu', `Demande de <@${USER}>`, `✅ 1. **${CALM}**`, `❌ 2. **${CALM}** : Salon introuvable`, `3. **${CALM}**`, `-# 1/3 action(s) exécutée(s). Arrêt sur ${CALM} : Salon introuvable`],
      receipt: `⚠️ **Plan interrompu**\n1/3 action(s) exécutée(s). Arrêt sur ${CALM} : Salon introuvable`,
      audit: auditRow('plan.interrupted', { planId: PLAN, done: 1, total: 3, stoppedAt: CALM, reason: 'Salon introuvable' }),
    });
    expect(h.audit.record.mock.calls.map(([row]) => [row.action, row.metadata.ok, row.metadata.summary])).toEqual([
      ['plan.action', true, 'fait'],
      ['plan.action', false, 'Salon introuvable'],
      ['plan.interrupted', undefined, undefined],
    ]);
  });

  it('le compte rendu d\'une action est tracé coupé à 200 caractères', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }]]);
    h.registry.run.mockResolvedValue({ ok: false, summary: 'r'.repeat(240) });
    await h.service.apply(PLAN, h.interaction as never);
    expect(h.audit.record.mock.calls[0]).toEqual([auditRow('plan.action', { planId: PLAN, tool: CALM, ok: false, summary: 'r'.repeat(200) })]);
  });

  it('outil inconnu au clic : interrompu avant de l\'exécuter', async () => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }], [CALM, { target: 'salon-b' }]]);
    h.registry.get.mockReturnValue(undefined);
    await h.service.apply(PLAN, h.interaction as never);
    const UNKNOWN = `outil « ${CALM} » inconnu`;
    expect(h.registry.run).not.toHaveBeenCalled();
    expectStopped(h, {
      status: 'interrupted',
      report: { done: 0, stoppedAt: CALM, reason: UNKNOWN },
      panel: ['## Plan interrompu', `Demande de <@${USER}>`, `❌ 1. **${CALM}** : ${UNKNOWN}`, `2. **${CALM}**`, `-# 0/2 action(s) exécutée(s). Arrêt sur ${CALM} : ${UNKNOWN}`],
      receipt: `⚠️ **Plan interrompu**\n0/2 action(s) exécutée(s). Arrêt sur ${CALM} : ${UNKNOWN}`,
      audit: auditRow('plan.interrupted', { planId: PLAN, done: 0, total: 2, stoppedAt: CALM, reason: UNKNOWN }),
    });
    expect(auditActions(h)).toEqual(['plan.interrupted']);
  });

  it.each([
    ['une erreur', new Error('base indisponible'), 'base indisponible'],
    ['une valeur jetée', 'échec', 'échec'],
    ['un message trop long', new Error('e'.repeat(240)), 'e'.repeat(200)],
  ] as const)('échec imprévu (%s) : le clic reçoit quand même son accusé, le plan est refermé interrompu avec cette raison', async (_label, thrown, reason) => {
    const h = harness();
    await postedPlan(h, [[CALM, { target: 'salon-a' }], [CALM, { target: 'salon-b' }]]);
    h.registry.run.mockImplementation(async (_name, input) => {
      if (input.target === 'salon-b') throw thrown;
      return { ok: true, summary: 'fait' };
    });

    await expect(h.service.apply(PLAN, h.interaction as never)).resolves.toBeUndefined();

    expect(h.registry.run.mock.calls.map(([, input]) => input.target)).toEqual(['salon-a', 'salon-b']);
    // Même refermeture qu'un arrêt décidé par la Policy : panneau remplacé, trace finale, accusé.
    expectStopped(h, {
      status: 'interrupted',
      report: { done: 1, reason },
      panel: ['## Plan interrompu', `Demande de <@${USER}>`, `✅ 1. **${CALM}**`, `❌ 2. **${CALM}** : ${reason}`, expect.stringContaining(reason)],
      receipt: expect.stringMatching(new RegExp(`Plan interrompu[^]*${reason.slice(0, 40)}`, 'u')),
      audit: auditRow('plan.interrupted', { planId: PLAN, done: 1, total: 2, stoppedAt: undefined, reason }),
    });
  });
});
