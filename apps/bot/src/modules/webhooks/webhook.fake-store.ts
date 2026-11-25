import { vi } from 'vitest';
import type { WebhookEndpointRow } from './webhook-endpoint.codec';

/**
 * Base en mémoire des connecteurs, pour les specs du module (aucun code de
 * production ne l'importe, comme `src/test/fake-db.ts`) : la table
 * `webhookEndpoint` telle que le service la lit et l'écrit, avec la clé unique
 * (serveur, slug) et l'erreur P2002 de Prisma quand elle est violée. Les
 * colonnes JSON restent des chaînes, comme en base ; les secrets y sont
 * chiffrés par le service lui-même, avec la clé maîtresse de test.
 */

type Clause = { id?: string; slug?: string };
type Fields = Omit<WebhookEndpointRow, 'id' | 'createdAt' | 'updatedAt' | 'lastHttpStatus' | 'lastCheckedAt' | 'lastError'>;

/** Identifiants des fixtures. */
export const GUILD = '1550000000000000001';
export const OTHER_GUILD = '1550000000000000002';
export const ACTOR = '1550000000000000003';

/** Clé maîtresse factice, sans valeur utilisable (celle des autres specs). */
export const TEST_KEY = 'test-key-not-real';

/** Valeur d'un en-tête secret des fixtures : jamais utilisable, et jamais dans une vue. */
export const SECRET_HEADER_VALUE = `Bearer ${TEST_KEY}`;

// Clé calculée : le scanner du registre des outils lit, dans toute source suivie, une clé name suivie d'une chaîne littérale.
const NAME = 'name';

const NOW = new Date('2026-11-25T10:00:00.000Z');

/** Une ligne de connecteur (serveur GUILD, slug « orders », activé, sans secret). */
export function webhookRow(overrides: Partial<WebhookEndpointRow> = {}): WebhookEndpointRow {
  return {
    id: 'wh_1',
    guildId: GUILD,
    slug: 'orders',
    [NAME]: 'Commandes',
    method: 'POST',
    url: 'https://api.example.test/hooks/orders',
    authType: 'none',
    authHeaderName: null,
    encryptedHeaders: null,
    publicHeadersJson: null,
    requestTemplateJson: null,
    responseExtractPath: null,
    enabled: true,
    lastHttpStatus: null,
    lastCheckedAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function fakeWebhookStore(seed: WebhookEndpointRow[] = []) {
  const rows = new Map<string, WebhookEndpointRow>(seed.map((row) => [row.id, { ...row }]));
  const of = (guildId: string) => [...rows.values()].filter((row) => row.guildId === guildId);
  const copy = (row: WebhookEndpointRow): WebhookEndpointRow => ({ ...row });
  let sequence = seed.length;
  return {
    rows,
    webhookEndpoint: {
      findMany: vi.fn(async (args: { where: { guildId: string; OR?: Clause[] }; take?: number }) =>
        of(args.where.guildId)
          .filter((row) => !args.where.OR || args.where.OR.some((clause) => clause.id === row.id || clause.slug === row.slug))
          .slice(0, args.take ?? Number.POSITIVE_INFINITY)
          .map(copy),
      ),
      findFirst: vi.fn(async (args: { where: { guildId: string; id: string } }) => {
        const row = rows.get(args.where.id);
        return row && row.guildId === args.where.guildId ? copy(row) : null;
      }),
      findUnique: vi.fn(async (args: { where: { guildId_slug: { guildId: string; slug: string } } }) => {
        const { guildId, slug } = args.where.guildId_slug;
        const row = of(guildId).find((candidate) => candidate.slug === slug);
        return row ? { id: row.id } : null;
      }),
      count: vi.fn(async (args: { where: { guildId: string } }) => of(args.where.guildId).length),
      create: vi.fn(async (args: { data: Fields }) => {
        if (of(args.data.guildId).some((row) => row.slug === args.data.slug)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        const row: WebhookEndpointRow = { ...args.data, id: `wh_${++sequence + 1}`, lastHttpStatus: null, lastCheckedAt: null, lastError: null, createdAt: NOW, updatedAt: NOW };
        rows.set(row.id, row);
        return copy(row);
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Partial<Fields> & { lastHttpStatus?: number | null; lastCheckedAt?: Date; lastError?: string | null } }) => {
        const row = rows.get(args.where.id);
        if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
        // Comme Prisma : un champ à `undefined` dans une mise à jour laisse la valeur en place.
        Object.assign(row, Object.fromEntries(Object.entries(args.data).filter(([, value]) => value !== undefined)), { updatedAt: NOW });
        return copy(row);
      }),
      deleteMany: vi.fn(async (args: { where: { guildId: string; id: string } }) => {
        const row = rows.get(args.where.id);
        if (!row || row.guildId !== args.where.guildId) return { count: 0 };
        rows.delete(row.id);
        return { count: 1 };
      }),
    },
  };
}

export type FakeWebhookStore = ReturnType<typeof fakeWebhookStore>;
