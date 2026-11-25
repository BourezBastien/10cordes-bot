import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CORRECTIONS_MAX, FACT_MAX } from './memory-correction.matcher';
import { CorrectionRefusedError } from './memory-correction.errors';
import { buildMemoryCorrectionTool } from './memory-correction.tool';
import { MemoryCorrectionService } from './memory-correction.service';
import type { MemoryCuratorService } from './memory-curator.service';

/*
 * Corrections de mémoire. Ce que fixent ces tests, sur une base en mémoire :
 * une correction périmée les entrées du journal qui portent l'ancien fait
 * (sans les supprimer), remplace la correction qu'elle prolonge, est portée
 * au conservateur, et reste bornée. Rien n'est écrit sur un membre qui a
 * demandé à être oublié, ni sur un fait qui répète celui qu'il prétend corriger.
 */

const GUILD = '1550000000000000001';
const USER = '1550000000000000002';
const ACTOR = '1550000000000000003';

type Row = { id: string } & Record<string, unknown>;
type Order = Record<'createdAt' | 'id', 'asc' | 'desc'>;

/** Table en mémoire : égalité stricte sur chaque champ du filtre, comme Prisma pour des scalaires. */
function table(seed: Row[] = []) {
  let sequence = 0;
  const rows = [...seed];
  const match = (row: Row, where: Record<string, unknown>): boolean => Object.entries(where).every(([key, value]) => (key === 'id' && value && typeof value === 'object' && 'in' in (value as object) ? ((value as { in: string[] }).in.includes(row.id)) : row[key] === value));
  return {
    rows,
    // Comme Prisma : `orderBy` sur la date de création puis l'identifiant, du plus récent au plus ancien (ou l'inverse).
    findMany: vi.fn(async (args: { where?: Record<string, unknown>; orderBy?: Order | Order[] } = {}) => {
      const hits = rows.filter((row) => match(row, args.where ?? {}));
      const order: Partial<Order>[] = args.orderBy === undefined ? [] : Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
      const first: Partial<Order> = order[0] ?? {};
      const second: Partial<Order> = order[1] ?? {};
      const compare = (a: Row, b: Row, key: 'createdAt' | 'id', direction: 'asc' | 'desc'): number =>
        (String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0) * (direction === 'asc' ? 1 : -1);
      return [...hits].sort((a, b) => (first.createdAt ? compare(a, b, 'createdAt', first.createdAt) : 0) || (second.id ? compare(a, b, 'id', second.id) : 0));
    }),
    findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => rows.find((row) => match(row, args.where)) ?? null),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      const row = { id: `row-${String(++sequence).padStart(3, '0')}`, createdAt: new Date(), supersededAt: null, ...args.data };
      rows.push(row);
      return row;
    }),
    updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hits = rows.filter((row) => match(row, args.where));
      for (const row of hits) Object.assign(row, args.data);
      return { count: hits.length };
    }),
  };
}

function harness(options: { optedOut?: boolean } = {}) {
  const prisma = {
    memoryCorrection: table(),
    guildMemory: table(),
    memberMemory: table(),
    memoryOptOut: { findFirst: vi.fn(async () => (options.optedOut ? { userId: USER, guildId: GUILD } : null)) },
  };
  const curator = {
    consolidateMember: vi.fn(async () => ({ status: 'appended', text: 'fiche' })),
    consolidateGuild: vi.fn(async () => ({ status: 'appended', text: 'fiche' })),
  };
  const audit = { record: vi.fn() };
  const registry = { register: vi.fn() };
  const service = new MemoryCorrectionService(prisma as never, registry as never, audit as never, curator as unknown as MemoryCuratorService);
  return { prisma, curator, audit, registry, service };
}

const input = (overrides: Partial<Parameters<MemoryCorrectionService['record']>[0]> = {}) => ({ guildId: GUILD, userId: USER, oldFact: 'habite à Lille', newFact: 'habite à Lyon', actorId: ACTOR, ...overrides });

describe('MemoryCorrectionService · record', () => {
  it('retient la correction, et porte au journal : les entrées qui portent l\u0027ancien fait sont périmées, les autres restent', async () => {
    const { service, prisma, curator, audit } = harness();
    await prisma.memberMemory.create({ data: { guildId: GUILD, userId: USER, content: '<@1550000000000000002> habite à Lille' } });
    await prisma.memberMemory.create({ data: { guildId: GUILD, userId: USER, content: 'a visité Lille en 2020' } });
    await prisma.memberMemory.create({ data: { guildId: GUILD, userId: USER, content: 'aime les pizzas' } });
    await prisma.guildMemory.create({ data: { guildId: GUILD, content: 'Le fondateur habite à Lille' } });

    const outcome = await service.record(input());

    expect(outcome.supersededEntries).toBe(1);
    expect(outcome.supersededCorrections).toBe(0);
    expect(prisma.memberMemory.rows.map((row) => [row.content, row.supersededAt !== null])).toEqual([
      ['<@1550000000000000002> habite à Lille', true],
      ['a visité Lille en 2020', false],
      ['aime les pizzas', false],
    ]);
    // Le journal du serveur n'est pas celui du membre.
    expect(prisma.guildMemory.rows[0]?.supersededAt).toBeNull();
    expect(curator.consolidateMember).toHaveBeenCalledWith(GUILD, USER, ACTOR, 'habite à Lyon', { oldFact: 'habite à Lille', newFact: 'habite à Lyon' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: GUILD, action: 'memory.corrected', actorId: ACTOR, targetId: USER, metadata: expect.objectContaining({ scope: 'member', supersededEntries: 1, supersededCorrections: 0 }) }),
    );
  });

  it('sur le serveur entier : le journal du serveur est lu, et le conservateur du serveur est appelé', async () => {
    const { service, prisma, curator } = harness();
    await prisma.guildMemory.create({ data: { guildId: GUILD, content: 'Le fondateur habite à Lille' } });
    const outcome = await service.record(input({ userId: null }));
    expect(outcome.supersededEntries).toBe(1);
    expect(curator.consolidateGuild).toHaveBeenCalledWith(GUILD, ACTOR, 'habite à Lyon', { oldFact: 'habite à Lille', newFact: 'habite à Lyon' });
    expect(curator.consolidateMember).not.toHaveBeenCalled();
  });

  it('une correction qui prolonge une correction plus ancienne la remplace : seul le dernier maillon reste actif', async () => {
    const { service } = harness();
    await service.record(input());
    const second = await service.record(input({ oldFact: 'habite à Lyon', newFact: 'habite à Marseille' }));
    expect(second.supersededCorrections).toBe(1);
    expect((await service.activeOf(GUILD, USER)).map((correction) => correction.newFact)).toEqual(['habite à Marseille']);
  });

  it('une correction sans rapport laisse les corrections en place', async () => {
    const { service } = harness();
    await service.record(input());
    await service.record(input({ oldFact: 'travaille comme boulanger', newFact: 'travaille comme journaliste' }));
    expect((await service.activeOf(GUILD, USER)).map((correction) => correction.oldFact).sort()).toEqual(['habite à Lille', 'travaille comme boulanger']);
  });

  it('au-delà de 20 corrections actives, les plus anciennes cèdent la place, jamais celle qu\u0027on vient d\u0027écrire', async () => {
    const { service } = harness();
    for (let index = 0; index < CORRECTIONS_MAX + 1; index += 1) await service.record(input({ oldFact: `fait ancien numéro ${index}`, newFact: `fait nouveau numéro ${index}` }));
    const active = await service.activeOf(GUILD, USER);
    expect(active).toHaveLength(CORRECTIONS_MAX);
    expect(active[0]?.newFact).toBe(`fait nouveau numéro ${CORRECTIONS_MAX}`);
  });
});

describe('MemoryCorrectionService · refus', () => {
  it.each([
    ['un fait trop court', input({ oldFact: 'x' })],
    ['un fait trop long', input({ newFact: 'n'.repeat(FACT_MAX.new + 1) })],
    ['une correction qui répète le fait', input({ oldFact: 'habite à Lille', newFact: 'Habite à Lille !' })],
  ])('%s est refusé avant toute écriture', async (_label, refused) => {
    const { service, prisma, curator, audit } = harness();
    await expect(service.record(refused)).rejects.toBeInstanceOf(CorrectionRefusedError);
    expect(prisma.memoryCorrection.create).not.toHaveBeenCalled();
    expect(curator.consolidateMember).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rien n\u0027est retenu sur un membre qui a demandé à être oublié ; sur le serveur, l\u0027oubli d\u0027un membre ne compte pas', async () => {
    const { service } = harness({ optedOut: true });
    await expect(service.record(input())).rejects.toThrow('demandé à être oublié');
    await expect(service.record(input({ userId: null }))).resolves.toMatchObject({ supersededEntries: 0 });
  });
});

describe('outil memory.correct', () => {
  const ctx = (permissions: string[], userId = USER) => ({ guildId: GUILD, userId, permissions, locale: 'fr', roleIds: [] }) as never;

  function tool(harn: ReturnType<typeof harness>) {
    return buildMemoryCorrectionTool({ corrections: harn.service });
  }

  it('s\u0027enregistre au démarrage, classé parmi les outils de mémoire', async () => {
    const harn = harness();
    harn.service.onBoot();
    expect(harn.registry.register).toHaveBeenCalledTimes(1);
    expect(harn.registry.register.mock.calls[0]?.[0]).toMatchObject({ name: 'memory.correct', category: 'memory' });
  });

  it('par défaut, la correction porte sur le demandeur lui-même', async () => {
    const harn = harness();
    const result = await tool(harn).handler({ oldFact: 'habite à Lille', newFact: 'habite à Lyon' }, ctx([]));
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Mémoire corrigée (<@1550000000000000002>)');
    expect(result.summary).toContain('« habite à Lyon » remplace « habite à Lille »');
    expect(harn.curator.consolidateMember).toHaveBeenCalledWith(GUILD, USER, USER, 'habite à Lyon', expect.anything());
  });

  it('corriger un autre membre, ou le serveur entier, exige ManageGuild ou Administrator', async () => {
    const harn = harness();
    const facts = { oldFact: 'habite à Lille', newFact: 'habite à Lyon' };
    const other = ctx([], ACTOR);
    expect(await tool(harn).handler({ ...facts, userId: USER }, other)).toMatchObject({ ok: false, summary: expect.stringContaining('ManageGuild') });
    expect(await tool(harn).handler({ ...facts, scope: 'server' }, other)).toMatchObject({ ok: false, summary: expect.stringContaining('ManageGuild') });
    expect(harn.prisma.memoryCorrection.create).not.toHaveBeenCalled();
    expect(await tool(harn).handler({ ...facts, scope: 'server' }, ctx(['ManageGuild'], ACTOR))).toMatchObject({ ok: true });
    expect(harn.prisma.memoryCorrection.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ userId: null, createdBy: ACTOR }) });
    expect(await tool(harn).handler({ ...facts, userId: USER }, ctx(['Administrator'], ACTOR))).toMatchObject({ ok: true });
    expect(harn.prisma.memoryCorrection.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ userId: USER, createdBy: ACTOR }) });
  });

  it('un refus du contrat est un résultat, pas un échec ; hors serveur, rien ne se fait', async () => {
    const harn = harness({ optedOut: true });
    expect(await tool(harn).handler({ oldFact: 'habite à Lille', newFact: 'habite à Lyon' }, ctx([]))).toMatchObject({ ok: false, summary: expect.stringContaining('oublié') });
    expect(await tool(harn).handler({ oldFact: 'habite à Lille', newFact: 'habite à Lyon' }, { guildId: null, userId: USER, permissions: [] } as never)).toMatchObject({ ok: false, summary: 'Contexte de serveur requis.' });
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
