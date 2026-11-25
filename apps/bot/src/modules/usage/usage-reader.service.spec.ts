import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { UsageSummarySchema } from '@10cordes/shared';
import { UsageReaderService } from './usage-reader.service';

/**
 * Lecture du journal des appels au modèle. Deux niveaux, parce que chacun
 * prouve ce que l'autre ne peut pas :
 * - sur un Prisma factice, l'horloge est fixée et le fuseau imposé : la
 *   fenêtre, l'axe des jours (jours sans appel à zéro, changement d'heure,
 *   jour local et non UTC), le tri et les totaux sont vérifiés à la valeur près ;
 * - sur une vraie base SQLite jetable (la table est celle de la migration),
 *   les agrégats sont de vrais BigInt et les dates de vraies millisecondes :
 *   ce qui est compté est ce que la fenêtre contient vraiment.
 */

const GUILD = '1550000000000000001';
const OTHER_GUILD = '1550000000000000008';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Un mercredi de novembre, midi UTC : ni changement d'heure ni minuit en vue. */
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);

/** Une ligne de l'agrégat par modèle, telle que SQLite la rend (BigInt). */
const line = (provider: string | null, model: string | null, promptTokens: bigint): Record<string, unknown> => ({
  provider,
  model,
  turns: 1n,
  promptTokens,
  completionTokens: 2n,
  errors: 0n,
  fallbacks: 0n,
});

/** Prisma factice : `$queryRaw` répond selon la requête (par modèle, ou par jour) et garde les appels. */
function fakePrisma(answer: { models?: unknown[]; days?: unknown[] } = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const queryRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?').replace(/\s+/gu, ' ');
    calls.push({ sql, values });
    return sql.includes('strftime') ? (answer.days ?? []) : (answer.models ?? []);
  });
  return { calls, prisma: { $queryRaw: queryRaw } };
}

/** Jours calendaires de `first` à `last` compris (dates UTC : indépendant du fuseau de la machine). */
function calendarDays(first: string, last: string): string[] {
  const [year, month, date] = first.split('-').map(Number);
  const days: string[] = [];
  for (let time = Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1); time <= Date.parse(`${last}T00:00:00Z`); time += DAY) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}

/** Jour local d'un instant, `AAAA-MM-JJ` : ce que `strftime(..., 'localtime')` écrit de son côté, dans SQLite. */
function localDay(time: number): string {
  const date = new Date(time);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

/** Aucun BigInt dans la réponse, et des entiers partout où il y a un nombre. */
function expectPlainNumbers(value: unknown, path = '$'): void {
  if (typeof value === 'bigint') throw new Error(`BigInt à ${path}`);
  if (typeof value === 'number') {
    expect(Number.isInteger(value), path).toBe(true);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) expectPlainNumbers(item, `${path}.${key}`);
  }
}

describe('UsageReaderService · fenêtre, agrégats et axe des jours', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each([
    ['24h', 24 * HOUR],
    ['7d', 7 * DAY],
    ['30d', 30 * DAY],
  ] as const)('fenêtre %s : les deux requêtes ne lisent que ce serveur, depuis maintenant moins la fenêtre', async (window, hours) => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const { prisma, calls } = fakePrisma();
    await new UsageReaderService(prisma as never).summary(GUILD, window);
    expect(calls).toHaveLength(2);
    for (const { sql, values } of calls) {
      expect(values).toEqual([GUILD, NOW - hours]);
      expect(sql).toContain('FROM "llm_usage_rows" WHERE "guildId" = ? AND "createdAt" >= ?');
    }
  });

  it('totalise TOUTES les lignes, garde les 25 modèles les plus gourmands, à égalité par fournisseur puis modèle', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const { prisma } = fakePrisma({
      models: [
        ...Array.from({ length: 30 }, (_, index) => line('p', `m${index}`, BigInt(index))),
        { ...line(null, null, 100n), errors: 3n, fallbacks: 2n },
        line('a', 'twin', 10n),
      ],
    });
    const summary = await new UsageReaderService(prisma as never).summary(GUILD, '7d');
    expect(summary).toMatchObject({ window: '7d', turns: 32, promptTokens: 545, completionTokens: 64, errors: 3, fallbacks: 2 });
    expect(summary.byModel).toHaveLength(25);
    // Une ligne sans modèle garde son fournisseur à null et prend l'étiquette du journal des coûts.
    expect(summary.byModel[0]).toEqual({ provider: null, model: 'runtime', turns: 1, promptTokens: 100, completionTokens: 2, errors: 3, fallbacks: 2 });
    expect(summary.byModel.slice(19, 25).map((entry) => [entry.provider, entry.model])).toEqual([
      ['p', 'm11'],
      ['a', 'twin'],
      ['p', 'm10'],
      ['p', 'm9'],
      ['p', 'm8'],
      ['p', 'm7'],
    ]);
    expect(summary.byModel.at(-1)?.model).toBe('m7');
    expectPlainNumbers(summary);
    expect(UsageSummarySchema.parse(summary)).toEqual(summary);
  });

  it('sans aucun appel : totaux à zéro, détail vide, et l\u0027axe des jours quand même', async () => {
    vi.stubEnv('TZ', 'UTC');
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const { prisma } = fakePrisma();
    expect(await new UsageReaderService(prisma as never).summary(GUILD, '24h')).toEqual({
      window: '24h',
      turns: 0,
      promptTokens: 0,
      completionTokens: 0,
      errors: 0,
      fallbacks: 0,
      byModel: [],
      byDay: [
        { day: '2026-11-24', turns: 0, tokens: 0 },
        { day: '2026-11-25', turns: 0, tokens: 0 },
      ],
    });
  });

  it('l\u0027axe va du jour local du début de la fenêtre à aujourd\u0027hui : un jour sans appel vaut zéro, sans BigInt à l\u0027arrivée', async () => {
    vi.stubEnv('TZ', 'UTC');
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const { prisma } = fakePrisma({
      models: [line('p', 'm', 30n)],
      days: [
        { day: '2026-11-18', turns: 1n, tokens: 9_007_199_254_740_991n },
        { day: '2026-11-25', turns: 1n, tokens: 32n },
      ],
    });
    const { byDay } = await new UsageReaderService(prisma as never).summary(GUILD, '7d');
    expect(byDay).toEqual([
      { day: '2026-11-18', turns: 1, tokens: 9_007_199_254_740_991 },
      ...Array.from({ length: 6 }, (_, index) => ({ day: `2026-11-${19 + index}`, turns: 0, tokens: 0 })),
      { day: '2026-11-25', turns: 1, tokens: 32 },
    ]);
  });

  it.each([
    // Lendemain du passage à l'heure d'hiver : la journée du 25 octobre a duré 25 heures.
    ['Europe/Paris', Date.UTC(2026, 9, 26, 2, 30), '2026-10-19', '2026-10-26'],
    // 01:30 locales le 26 novembre : le jour local n'est pas celui de l'UTC.
    ['Asia/Kolkata', Date.UTC(2026, 10, 25, 20, 0), '2026-11-19', '2026-11-26'],
  ])('en %s, l\u0027axe suit les jours locaux, sans saut ni répétition', async (zone, now, first, last) => {
    vi.stubEnv('TZ', zone);
    vi.useFakeTimers({ toFake: ['Date'], now });
    const { prisma } = fakePrisma({ days: [{ day: last, turns: 1n, tokens: 1n }] });
    const { byDay } = await new UsageReaderService(prisma as never).summary(GUILD, '7d');
    expect(byDay.map((entry) => entry.day)).toEqual(calendarDays(first, last));
    expect(byDay.at(-1)).toEqual({ day: last, turns: 1, tokens: 1 });
  });
});

/** Base SQLite jetable, hors du dépôt : sa table est celle de la migration, jamais celle de la base du bot. */
async function disposableDatabase(): Promise<{ prisma: PrismaClient; close: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), '10cordes-usage-'));
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${join(dir, 'usage.db')}` } }, errorFormat: 'minimal' });
  await prisma.$executeRawUnsafe(readFileSync(new URL('../../../prisma/migrations/20261125090000_llm_usage_rows/migration.sql', import.meta.url), 'utf8'));
  return {
    prisma,
    // Sous Windows, le fichier reste un instant pris par le moteur après la déconnexion : la suppression se retente.
    close: async () => void ((await prisma.$disconnect(), rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 }))),
  };
}

describe('UsageReaderService · sur une base SQLite réelle', () => {
  it('compte ce que la fenêtre contient vraiment, et les BigInt des agrégats deviennent des nombres', async () => {
    const db = await disposableDatabase();
    try {
      const now = Date.now();
      const call = (ageMs: number, overrides: Partial<Prisma.LlmUsageRowCreateManyInput> = {}): Prisma.LlmUsageRowCreateManyInput => ({
        guildId: GUILD,
        cause: 'reply',
        capability: 'chat.default',
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        promptTokens: 100,
        completionTokens: 50,
        ms: 900,
        ok: true,
        fallback: false,
        createdAt: new Date(now - ageMs),
        ...overrides,
      });
      await db.prisma.llmUsageRow.createMany({
        data: [
          call(HOUR),
          call(2 * HOUR, { provider: 'kie-ai', model: 'kimi-k2.5', capability: null, ok: false, fallback: true }),
          call(30 * HOUR, { promptTokens: 1000 }),
          call(40 * DAY, { promptTokens: 10_000 }),
          call(HOUR, { guildId: OTHER_GUILD, promptTokens: 50_000 }),
        ],
      });
      const reader = new UsageReaderService(db.prisma as never);
      const byModel = [
        { provider: 'deepseek-official', model: 'deepseek-flash', turns: 1, promptTokens: 100, completionTokens: 50, errors: 0, fallbacks: 0 },
        { provider: 'kie-ai', model: 'kimi-k2.5', turns: 1, promptTokens: 100, completionTokens: 50, errors: 1, fallbacks: 1 },
      ];

      // Sur 24 h : les deux appels récents, pas celui d'il y a 30 heures.
      expect(await reader.summary(GUILD, '24h')).toMatchObject({ window: '24h', turns: 2, promptTokens: 200, completionTokens: 100, errors: 1, fallbacks: 1, byModel });

      const today = localDay(now);
      const week = await reader.summary(GUILD, '7d');
      expect(week).toMatchObject({ window: '7d', turns: 3, promptTokens: 1200, completionTokens: 150, errors: 1, fallbacks: 1 });
      expect(week.byModel[0]).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash', turns: 2, promptTokens: 1100, completionTokens: 100, errors: 0, fallbacks: 0 });
      expect(week.byModel[1]).toEqual(byModel[1]);
      // Le jour local écrit par SQLite est celui que la machine donne du même instant.
      expect(week.byDay.filter((entry) => entry.turns > 0)).toEqual([
        { day: localDay(now - 30 * HOUR), turns: 1, tokens: 1050 },
        { day: today, turns: 2, tokens: 300 },
      ]);
      expect(week.byDay.map((entry) => entry.day)).toEqual(calendarDays(localDay(now - 7 * DAY), today));
      expect(week.byDay.reduce((sum, entry) => sum + entry.tokens, 0)).toBe(1350);

      // Sur 30 jours : l'appel de 40 jours est hors fenêtre, et le serveur voisin ne compte pas.
      const month = await reader.summary(GUILD, '30d');
      expect(month).toMatchObject({ turns: 3, promptTokens: 1200, completionTokens: 150 });
      expect((await reader.summary(OTHER_GUILD, '30d')).promptTokens).toBe(50_000);

      for (const summary of [week, month]) {
        expectPlainNumbers(summary);
        expect(UsageSummarySchema.parse(summary)).toEqual(summary);
      }
    } finally {
      await db.close();
    }
  });
});
