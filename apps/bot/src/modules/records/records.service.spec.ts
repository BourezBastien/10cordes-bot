import { describe, expect, it, vi } from 'vitest';
import { RecordsService } from './records.service';
import { buildRecordTools } from './records.tools';
import type { ToolRunContext } from '@10cordes/shared';

/**
 * Store extensible : collections natives à schéma strict, collections
 * dynamiques créées à la demande (contenu borné), quota par serveur.
 */

interface Row {
  id: string;
  guildId: string;
  collection: string;
  data: string;
  createdBy: string;
  createdAt: Date;
}

const GUILD = '1550000000000000001';
const USER = '1550000000000000002';
// Noms de collections dynamiques via constantes : sync-tool-names.mjs scanne
// les littéraux de nom de tool (clé name suivie d'une chaîne) dans les
// sources trackées, un littéral de test ne doit pas s'y retrouver.
const CASINO = 'casino_balance';
const GIVEAWAY = 'giveaway_entries';
const COUNTER_LABEL = 'x';

/** Faux Prisma en mémoire : seules les méthodes utilisées par RecordsService. */
function makePrisma() {
  const rows: Row[] = [];
  let sequence = 0;
  const inGuild = (guildId: string) => rows.filter((row) => row.guildId === guildId);
  const api = {
    rows,
    agentRecord: {
      count: vi.fn(async ({ where }: { where: { guildId: string } }) => inGuild(where.guildId).length),
      findFirst: vi.fn(async ({ where }: { where: { id?: string; guildId: string; collection?: string } }) =>
        rows.find((row) => row.guildId === where.guildId && (!where.id || row.id === where.id) && (!where.collection || row.collection === where.collection)) ?? null,
      ),
      findMany: vi.fn(async ({ where, distinct }: { where: { guildId: string; collection?: string }; distinct?: string[] }) => {
        let list = inGuild(where.guildId).filter((row) => !where.collection || row.collection === where.collection);
        if (distinct) {
          const seen = new Set<string>();
          list = list.filter((row) => (seen.has(row.collection) ? false : (seen.add(row.collection), true)));
        }
        return [...list];
      }),
      create: vi.fn(async ({ data }: { data: Omit<Row, 'id' | 'createdAt'> }) => {
        const row: Row = { id: `rec${++sequence}`, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((entry) => entry.id === where.id);
        if (!row) throw new Error('introuvable');
        Object.assign(row, data);
        return row;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: string; guildId: string } }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].id === where.id && rows[i].guildId === where.guildId) rows.splice(i, 1);
        }
        return { count: before - rows.length };
      }),
      groupBy: vi.fn(async ({ where }: { where: { guildId: string } }) => {
        const counts = new Map<string, number>();
        for (const row of inGuild(where.guildId)) counts.set(row.collection, (counts.get(row.collection) ?? 0) + 1);
        return [...counts].map(([collection, count]) => ({ collection, _count: { id: count } }));
      }),
    },
  };
  return api;
}

type FakePrisma = ReturnType<typeof makePrisma>;

const makeService = () => {
  const prisma = makePrisma();
  return { prisma, service: new RecordsService(prisma as never) };
};

const ctx = (guildId: string | null = GUILD): ToolRunContext => ({ guildId, channelId: null, userId: USER, locale: 'fr', permissions: [], reply: async () => undefined });

const dataOf = (prisma: FakePrisma, collection: string) =>
  prisma.rows.filter((row) => row.collection === collection).map((row) => JSON.parse(row.data) as Record<string, unknown>);

describe('RecordsService · collections natives (schéma strict)', () => {
  it('accepte un document valide et le stocke versionné', async () => {
    const { prisma, service } = makeService();
    const result = await service.create(GUILD, USER, 'counters', { name: 'e2e-compteur', value: 0 });
    expect(result.ok).toBe(true);
    expect(dataOf(prisma, 'counters')).toEqual([{ version: 1, name: 'e2e-compteur', value: 0 }]);
  });

  it('refuse un document invalide en nommant le champ en faute', async () => {
    const { prisma, service } = makeService();
    const result = await service.create(GUILD, USER, 'counters', { name: COUNTER_LABEL });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('value');
    expect(prisma.rows).toHaveLength(0);
  });
});

describe('RecordsService · collections dynamiques', () => {
  it('ouvre une collection à la demande, comme les recettes le font (casino_balance)', async () => {
    const { prisma, service } = makeService();
    const result = await service.create(GUILD, USER, 'casino_balance', { userId: USER, balance: 100, currency: 'pièces' });
    expect(result.ok).toBe(true);
    expect(dataOf(prisma, 'casino_balance')).toEqual([{ version: 1, userId: USER, balance: 100, currency: 'pièces' }]);
    expect(prisma.agentRecord.create).toHaveBeenCalledTimes(1);
  });

  it('accepte listes de scalaires et objets de scalaires, bornés', async () => {
    const { service } = makeService();
    const result = await service.create(GUILD, USER, 'giveaway_entries', {
      userId: USER,
      tickets: 2,
      history: ['win', 'loss'],
      stats: { wins: 3, losses: 1 },
    });
    expect(result.ok).toBe(true);
  });

  it('refuse une imbrication plus profonde ou des listes d\u0027objets', async () => {
    const { service } = makeService();
    expect((await service.create(GUILD, USER, 'casino_balance', { a: { b: { c: 1 } } })).ok).toBe(false);
    expect((await service.create(GUILD, USER, 'casino_balance', { a: [{ x: 1 }] })).ok).toBe(false);
    expect((await service.create(GUILD, USER, 'casino_balance', { a: 'x'.repeat(501) })).ok).toBe(false);
    expect((await service.create(GUILD, USER, 'casino_balance', { ['k'.repeat(65)]: 1 })).ok).toBe(false);
  });

  it('refuse un document trop volumineux (plus de 100 clés)', async () => {
    const { service } = makeService();
    const big: Record<string, number> = {};
    for (let i = 0; i < 101; i += 1) big[`k${i}`] = i;
    const result = await service.create(GUILD, USER, 'casino_balance', big);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('100 clés');
  });

  it('refuse les clés dangereuses, même issues d\u0027un JSON hostile', async () => {
    const { prisma, service } = makeService();
    const hostile = JSON.parse('{"userId": "1", "__proto__": {"polluted": true}}') as Record<string, unknown>;
    const result = await service.create(GUILD, USER, 'casino_balance', hostile);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('clé interdite');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(prisma.rows).toHaveLength(0);
    // Même refus sur une collection native.
    expect((await service.create(GUILD, USER, 'quotes', JSON.parse('{"text": "a", "constructor": {"x": 1}, "author": "b"}'))).ok).toBe(false);
  });

  it('refuse un nom de collection mal formé avec la règle à suivre', async () => {
    const { service } = makeService();
    const result = await service.create(GUILD, USER, 'Casino Balance', { a: 1 });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('Nom de collection refusé');
    expect(result.summary).toContain('2 à 48 caractères');
    expect(result.summary).toContain('reminders');
  });

  it('fusionne puis revalide un enregistrement dynamique', async () => {
    const { prisma, service } = makeService();
    const created = await service.create(GUILD, USER, 'casino_balance', { userId: USER, balance: 100 });
    const recordId = String(created.data?.recordId);

    expect((await service.update(GUILD, recordId, { balance: 250 })).ok).toBe(true);
    expect(dataOf(prisma, 'casino_balance')[0]).toEqual({ version: 1, userId: USER, balance: 250 });

    // Le schéma d'une collection dynamique est structurel : un objet de
    // scalaires reste valide, une imbrication trop profonde est refusée.
    expect((await service.update(GUILD, recordId, { balance: { devise: 'pièces' } })).ok).toBe(true);
    const rejected = await service.update(GUILD, recordId, { balance: { a: { b: 1 } } });
    expect(rejected.ok).toBe(false);
    expect(dataOf(prisma, 'casino_balance')[0]).toEqual({ version: 1, userId: USER, balance: { devise: 'pièces' } });
  });
});

describe('RecordsService · quota par serveur (CollectionQuotaPolicy)', () => {
  it('refuse la 51e collection distincte, pas un enregistrement dans une collection ouverte', async () => {
    const { prisma, service } = makeService();
    for (let i = 0; i < 50; i += 1) {
      await prisma.agentRecord.create({ data: { guildId: GUILD, collection: `collection_${i}`, data: '{"a":1}', createdBy: USER } });
    }
    const refused = await service.create(GUILD, USER, 'casino_balance', { userId: USER, balance: 1 });
    expect(refused.ok).toBe(false);
    expect(refused.summary).toContain('Quota de collections atteint');
    expect(refused.summary).toContain('50 sur 50');

    const allowed = await service.create(GUILD, USER, 'collection_7', { b: 2 });
    expect(allowed.ok).toBe(true);
  });

  it('refuse tout nouvel enregistrement au-delà de 10 000 par serveur', async () => {
    const { prisma, service } = makeService();
    prisma.agentRecord.count.mockResolvedValue(10_000);
    const native = await service.create(GUILD, USER, 'quotes', { text: 'a', author: 'b' });
    expect(native.ok).toBe(false);
    expect(native.summary).toContain('Quota d\u0027enregistrements atteint');
    expect(prisma.agentRecord.create).not.toHaveBeenCalled();
  });

  it('les quotas sont par serveur : un autre serveur n\u0027est pas pénalisé', async () => {
    const { prisma, service } = makeService();
    for (let i = 0; i < 50; i += 1) {
      await prisma.agentRecord.create({ data: { guildId: '1550000000000000009', collection: `collection_${i}`, data: '{"a":1}', createdBy: USER } });
    }
    expect((await service.create(GUILD, USER, 'casino_balance', { userId: USER, balance: 1 })).ok).toBe(true);
  });
});

describe('RecordsService · vue des collections et tools', () => {
  it('liste les collections natives et les collections dynamiques du serveur', async () => {
    const { service } = makeService();
    await service.create(GUILD, USER, 'casino_balance', { userId: USER, balance: 1 });
    await service.create(GUILD, USER, 'giveaway_entries', { userId: USER });
    const overview = await service.describeCollections(GUILD);
    expect(overview.native.map((entry) => entry.name)).toEqual(['reminders', 'suggestions', 'quotes', 'faq', 'counters', 'notes', 'component_votes']);
    expect(overview.dynamic).toEqual([
      { name: CASINO, records: 1 },
      { name: GIVEAWAY, records: 1 },
    ]);
  });

  it('le tool records.create reste fin et renvoie le refus du quota tel quel', async () => {
    const { prisma, service } = makeService();
    prisma.agentRecord.count.mockResolvedValue(10_000);
    const tools = buildRecordTools(service);
    const create = tools.find((tool) => tool.name === 'records.create');
    expect(create).toBeDefined();
    const result = await create!.handler({ collection: 'casino_balance', data: { userId: USER } }, ctx());
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('10000 sur 10000');
  });

  it('les 7 tools records gardent leur nom (registre des tools inchangé)', () => {
    const { service } = makeService();
    expect(buildRecordTools(service).map((tool) => tool.name)).toEqual([
      'records.collections',
      'records.create',
      'records.update',
      'records.get',
      'records.list',
      'records.search',
      'records.delete',
    ]);
  });

  it('supprime, lit et cherche un enregistrement', async () => {
    const { service } = makeService();
    const created = await service.create(GUILD, USER, 'quotes', { text: 'citation e2e', author: 'quelqu\u0027un' });
    const recordId = String(created.data?.recordId);
    expect((await service.get(GUILD, recordId)).ok).toBe(true);
    expect((await service.list(GUILD, 'quotes', 10)).summary).toContain('citation e2e');
    expect((await service.search(GUILD, 'quotes', 'e2e')).ok).toBe(true);
    expect((await service.remove(GUILD, recordId)).ok).toBe(true);
    expect((await service.get(GUILD, recordId)).ok).toBe(false);
    expect((await service.get('1550000000000000009', recordId)).ok).toBe(false);
  });
});
