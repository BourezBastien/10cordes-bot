import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SurfaceDefinitionSchema } from '@10cordes/shared';
import type { PlanAction } from '../../core/security/action-plan.policy';
import { ActionPlanStore } from './action-plan.store';
import { PLAN_LIMITS, type ActionPlan } from './action-plan.types';

/**
 * Persistance des plans d'action (table des surfaces interactives). Ce que
 * ces tests fixent : le statut d'un plan voyage dans le `kind` de sa ligne,
 * une ligne illisible n'est jamais lue comme un plan, la prise d'un plan
 * n'aboutit qu'une fois, et la purge ne retire que les plans en attente
 * expirés du serveur demandé.
 */

const GUILD = '1550000000000000001';
const OTHER_GUILD = '1550000000000000009';
const CHANNEL = '1550000000000000002';
const USER = '1550000000000000003';
const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const EXPIRES = T0 + PLAN_LIMITS.lifetimeMs;
const NOW = T0 + 2_000;

const FIRST: PlanAction = { tool: 'test.deleteThing', input: { target: 'salon-a' } };
const SECOND: PlanAction = { tool: 'test.deleteThing', input: { target: 'salon-b' } };

type PlanInput = Omit<ActionPlan, 'id'>;
type Row = { id: string; guildId: string; channelId: string; messageId: string | null; kind: string; definition: string; state: string; createdBy: string };
type Where = { id?: string; guildId?: string; kind?: string };

const plan = (overrides: Partial<PlanInput> = {}): PlanInput => ({
  guildId: GUILD,
  channelId: CHANNEL,
  requesterId: USER,
  messageId: null,
  actions: [FIRST],
  summary: null,
  dropped: [],
  status: 'pending',
  createdAt: T0,
  expiresAt: EXPIRES,
  report: null,
  ...overrides,
});

/** Ligne déjà en base, écrite hors du store, avec l'état sérialisé donné. */
const rawRow = (id: string, state: string, overrides: Partial<Row> = {}): Row => ({
  id,
  guildId: GUILD,
  channelId: CHANNEL,
  messageId: 'msg-1',
  kind: 'action-plan',
  definition: '{}',
  state,
  createdBy: USER,
  ...overrides,
});

/** Faux Prisma en mémoire : la table InteractiveSurface, son `kind` et son état sérialisé. */
function makePrisma(existing: Row[] = []) {
  const rows: Row[] = [...existing];
  let sequence = 0;
  // Un filtre absent ne filtre rien ; un filtre présent s'applique toujours (kind compris).
  const matches = (row: Row, where: Where): boolean => row.id === (where.id ?? row.id) && row.guildId === (where.guildId ?? row.guildId) && row.kind === (where.kind ?? row.kind);
  return {
    rows,
    interactiveSurface: {
      create: vi.fn(async ({ data }: { data: Partial<Row> }) => {
        for (const column of ['guildId', 'channelId', 'kind', 'definition', 'state', 'createdBy'] as const) {
          if (typeof data[column] !== 'string') throw new Error(`colonne ${column} obligatoire`);
        }
        const row = { id: `plan${++sequence}`, messageId: null, ...data } as Row;
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const row = rows.find((entry) => matches(entry, where));
        if (!row) throw new Error('enregistrement introuvable');
        Object.assign(row, data);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: Where }) => rows.find((entry) => matches(entry, where)) ?? null),
      findMany: vi.fn(async ({ where }: { where: Where }) => rows.filter((entry) => matches(entry, where))),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const matched = rows.filter((entry) => matches(entry, where));
        for (const row of matched) Object.assign(row, data);
        return { count: matched.length };
      }),
      delete: vi.fn(async ({ where }: { where: Where }) => {
        const index = rows.findIndex((entry) => matches(entry, where));
        if (index < 0) throw new Error('enregistrement introuvable');
        return rows.splice(index, 1)[0];
      }),
    },
  };
}

type Prisma = ReturnType<typeof makePrisma>;

const storeOf = (prisma: Prisma): ActionPlanStore => new ActionPlanStore(prisma as never);
const COLUMNS = { id: true, guildId: true, channelId: true, messageId: true, state: true };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ActionPlanStore · créer et relire', () => {
  it('create rend l\'identifiant de la ligne écrite : colonnes du plan, kind en attente, définition valide, demandeur', async () => {
    const prisma = makePrisma();
    await expect(storeOf(prisma).create(plan({ actions: [FIRST, SECOND] }))).resolves.toBe('plan1');
    expect(prisma.rows).toEqual([
      {
        id: 'plan1',
        guildId: GUILD,
        channelId: CHANNEL,
        messageId: null,
        kind: 'action-plan',
        definition: expect.any(String),
        state: JSON.stringify({ requesterId: USER, actions: [FIRST, SECOND], summary: null, dropped: [], status: 'pending', createdAt: T0, expiresAt: EXPIRES, report: null }),
        createdBy: USER,
      },
    ]);
    // La définition reste lisible par le moteur des surfaces : c'est la sienne, validée par son schéma.
    expect(SurfaceDefinitionSchema.safeParse(JSON.parse(prisma.rows[0].definition)).success).toBe(true);
    expect(prisma.interactiveSurface.create).toHaveBeenCalledTimes(1);
  });

  it('ce qui est créé se relit à l\'identique, l\'identifiant en plus', async () => {
    const prisma = makePrisma();
    const store = storeOf(prisma);
    const input = plan({
      actions: [FIRST, SECOND],
      summary: 'Je vais supprimer deux salons.',
      dropped: [{ tool: 'test.renameThing', reason: 'permission manquante dans ce salon : ManageChannels' }],
      status: 'interrupted',
      report: { done: 1, stoppedAt: SECOND.tool, reason: 'refusé' },
    });
    const id = await store.create(input);
    expect(await store.get(id)).toEqual({ id, ...input });
    expect(prisma.interactiveSurface.findUnique).toHaveBeenCalledWith({ where: { id }, select: COLUMNS });
  });

  it('une ligne absente n\'est pas un plan', async () => {
    expect(await storeOf(makePrisma()).get('aucun')).toBeNull();
  });

  it.each([
    ['JSON illisible', 'pas du JSON'],
    ['état vide', '{}'],
    ['sans demandeur', JSON.stringify({ actions: [FIRST], expiresAt: EXPIRES })],
    ['demandeur qui n\'est pas une chaîne', JSON.stringify({ requesterId: 42, actions: [FIRST], expiresAt: EXPIRES })],
    ['sans actions', JSON.stringify({ requesterId: USER, expiresAt: EXPIRES })],
    ['actions qui ne sont pas une liste', JSON.stringify({ requesterId: USER, actions: {}, expiresAt: EXPIRES })],
    ['sans expiration', JSON.stringify({ requesterId: USER, actions: [FIRST] })],
    ['expiration qui n\'est pas un nombre', JSON.stringify({ requesterId: USER, actions: [FIRST], expiresAt: 'demain' })],
  ])('état illisible (%s) : null plutôt qu\'un plan', async (_label, state) => {
    const prisma = makePrisma([rawRow('p1', state)]);
    expect(await storeOf(prisma).get('p1')).toBeNull();
  });

  it('un état ancien incomplet se lit comme un plan en attente, sans compte rendu, résumé ni action écartée, daté de maintenant', async () => {
    const prisma = makePrisma([rawRow('p1', JSON.stringify({ requesterId: USER, actions: [FIRST], expiresAt: EXPIRES }))]);
    expect(await storeOf(prisma).get('p1')).toEqual({
      id: 'p1',
      guildId: GUILD,
      channelId: CHANNEL,
      messageId: 'msg-1',
      requesterId: USER,
      actions: [FIRST],
      summary: null,
      dropped: [],
      status: 'pending',
      createdAt: NOW,
      expiresAt: EXPIRES,
      report: null,
    });
  });

  it('un résumé ou une liste d\'actions écartées d\'une autre forme se lisent comme absents', async () => {
    const prisma = makePrisma([rawRow('p1', JSON.stringify({ requesterId: USER, actions: [FIRST], expiresAt: EXPIRES, summary: 42, dropped: 'non' }))]);
    const plan = await storeOf(prisma).get('p1');
    expect(plan).toMatchObject({ summary: null, dropped: [] });
  });
});

describe('ActionPlanStore · enregistrer, le statut porté par le kind', () => {
  it.each([
    ['pending', 'action-plan'],
    ['executing', 'action-plan:locked'],
    ['executed', 'action-plan:closed'],
    ['interrupted', 'action-plan:closed'],
    ['cancelled', 'action-plan:closed'],
    ['expired', 'action-plan:closed'],
  ] as const)('statut %s : la ligne prend le kind %s et le nouvel état', async (status, kind) => {
    const prisma = makePrisma();
    const store = storeOf(prisma);
    const id = await store.create(plan());
    const report = status === 'interrupted' ? { done: 0, stoppedAt: FIRST.tool, reason: 'refusé' } : { done: 1 };
    await store.save({ ...plan({ status, report }), id, messageId: 'msg-1' });
    expect(prisma.interactiveSurface.update).toHaveBeenCalledWith({
      where: { id },
      data: { kind, messageId: 'msg-1', state: expect.any(String) },
      select: { id: true },
    });
    expect(JSON.parse(prisma.rows[0].state)).toEqual({ requesterId: USER, actions: [FIRST], summary: null, dropped: [], status, createdAt: T0, expiresAt: EXPIRES, report });
    expect(prisma.rows[0].kind).toBe(kind);
  });

  it('sans message, l\'enregistrement laisse la colonne messageId tranquille', async () => {
    const prisma = makePrisma();
    const store = storeOf(prisma);
    const id = await store.create(plan());
    await store.save({ ...plan(), id, messageId: null });
    const [[call]] = prisma.interactiveSurface.update.mock.calls;
    expect(call).toEqual({ where: { id }, data: { kind: 'action-plan', state: expect.any(String) }, select: { id: true } });
    expect(call).not.toHaveProperty('data.messageId');
  });
});

describe('ActionPlanStore · prise du plan', () => {
  it('la première prise réussit par une mise à jour conditionnelle, la seconde échoue', async () => {
    const prisma = makePrisma();
    const store = storeOf(prisma);
    const id = await store.create(plan());
    await expect(store.lock(id)).resolves.toBe(true);
    await expect(store.lock(id)).resolves.toBe(false);
    const claim = { where: { id, kind: 'action-plan' }, data: { kind: 'action-plan:locked' } };
    expect(prisma.interactiveSurface.updateMany.mock.calls).toEqual([[claim], [claim]]);
    expect(prisma.rows[0].kind).toBe('action-plan:locked');
    // L'état sérialisé n'est pas réécrit : le kind seul fait foi.
    expect(JSON.parse(prisma.rows[0].state).status).toBe('pending');
  });

  it.each(['executing', 'executed', 'interrupted', 'cancelled', 'expired'] as const)('un plan au statut %s ne se prend plus', async (status) => {
    const prisma = makePrisma();
    const store = storeOf(prisma);
    const id = await store.create(plan());
    await store.save({ ...plan({ status }), id });
    await expect(store.lock(id)).resolves.toBe(false);
  });

  it('un identifiant inconnu ne se prend pas', async () => {
    const prisma = makePrisma();
    await expect(storeOf(prisma).lock('aucun')).resolves.toBe(false);
    expect(prisma.interactiveSurface.updateMany).toHaveBeenCalledWith({ where: { id: 'aucun', kind: 'action-plan' }, data: { kind: 'action-plan:locked' } });
  });
});

describe('ActionPlanStore · purge des plans expirés', () => {
  it('seuls les plans en attente expirés du serveur disparaissent, date d\'expiration comprise', async () => {
    const prisma = makePrisma();
    const store = storeOf(prisma);
    const gone = await store.create(plan({ expiresAt: T0 + 1_000 }));
    const atLimit = await store.create(plan({ expiresAt: NOW }));
    const live = await store.create(plan({ expiresAt: NOW + 1_000 }));
    await store.create(plan({ guildId: OTHER_GUILD, expiresAt: T0 }));
    const running = await store.create(plan({ expiresAt: T0 }));
    await store.save({ ...plan({ status: 'executing' }), id: running });
    const closed = await store.create(plan({ expiresAt: T0 }));
    await store.save({ ...plan({ status: 'cancelled' }), id: closed });
    // Une ligne en attente à l'état illisible ne se laisse ni lire ni purger.
    prisma.rows.push(rawRow('broken', 'pas du JSON'));

    await expect(store.purgeExpired(GUILD, NOW)).resolves.toBe(2);
    expect(prisma.rows.map((row) => row.id)).toEqual([live, 'plan4', running, closed, 'broken']);
    expect(prisma.interactiveSurface.findMany).toHaveBeenCalledWith({ where: { guildId: GUILD, kind: 'action-plan' }, select: COLUMNS });
    expect(prisma.interactiveSurface.delete.mock.calls).toEqual([[{ where: { id: gone } }], [{ where: { id: atLimit } }]]);
  });

  it('la purge d\'un serveur ne touche pas aux plans des autres', async () => {
    const prisma = makePrisma();
    const store = storeOf(prisma);
    await store.create(plan({ expiresAt: T0 }));
    await store.create(plan({ guildId: OTHER_GUILD, expiresAt: T0 }));
    await store.create(plan({ guildId: OTHER_GUILD, expiresAt: NOW + 1 }));

    await expect(store.purgeExpired(OTHER_GUILD, NOW)).resolves.toBe(1);
    expect(prisma.rows.map((row) => row.id)).toEqual(['plan1', 'plan3']);
  });
});
