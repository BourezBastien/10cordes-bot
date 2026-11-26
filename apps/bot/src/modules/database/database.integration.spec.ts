import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { summarizeActivity } from '../serverlife/activity-stats';
import { UsageReaderService } from '../usage/usage-reader.service';
import { readerOf, sqliteTablesOf, targetOf } from './migration/migration-ports';
import { orderModels } from './migration/migration-plan';
import { parsePrismaSchema } from './migration/schema-catalog';
import { SqliteToPostgresMigrator } from './migration/sqlite-to-postgres.migrator';
import { MigrationVerifyError } from './migration/table-copy';
import { PrismaService } from './prisma.service';

/**
 * INTÉGRATION, SUR LES DEUX MOTEURS RÉELS. Les mêmes requêtes, les mêmes
 * services et les mêmes assertions tournent sur une base SQLite jetable
 * (toujours) et sur une base PostgreSQL de test (quand TEST_DATABASE_URL est
 * donné : sans elle, la partie PostgreSQL est ignorée, jamais simulée).
 *
 * La base SQLite de test naît de l'historique figé des migrations SQLite
 * (prisma/migrations-sqlite), appliquées dans l'ordre, instruction par
 * instruction, sans passer par la CLI. La base PostgreSQL de test, elle, doit
 * être préparée AVANT la suite, qui la VIDE :
 *
 *   DATABASE_URL=<adresse de test> pnpm --filter 10cordes-bot db:deploy
 *   TEST_DATABASE_URL=<même adresse> pnpm --filter 10cordes-bot exec vitest run database.integration
 *
 * TEST_DATABASE_URL doit désigner une base de TEST : une base dont le nom ne
 * dit pas « test » ou « sandbox » est refusée.
 */

const BOT_DIR = join(import.meta.dirname, '..', '..', '..');
const MODELS = parsePrismaSchema(readFileSync(join(BOT_DIR, 'prisma/schema.sqlite.prisma'), 'utf8'));
/** L'ordre inverse de la copie : vider les tables sans heurter une clé étrangère. */
const DELETE_ORDER = orderModels(MODELS).reverse();

const TEST_POSTGRES = process.env.TEST_DATABASE_URL ?? '';
if (TEST_POSTGRES && !/test|sandbox|spec/iu.test(new URL(TEST_POSTGRES).pathname)) {
  throw new Error('TEST_DATABASE_URL doit désigner une base de test (un nom qui contient test ou sandbox) : la suite d\u0027intégration la vide.');
}

const GUILD = '1550000000000000001';
const OTHER_GUILD = '1550000000000000008';
const USER = '1550000000000000002';
const OTHER_USER = '1550000000000000003';
/** Un mercredi de novembre, midi UTC : ni changement d'heure ni minuit en vue. */
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Valeur fictive, à la forme d'un secret chiffré : la migration la copie sans la lire. */
const TEST_SECRET = 'v1:iv-de-test:tag-de-test:donnee-non-reelle';
/** Fuseau de la machine, lu avant que rien ne le change (la bibliothèque SQLite fixe le sien à son chargement). */
const SYSTEM_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** Jour local d'un instant, `AAAA-MM-JJ`. */
const localDay = (time: number): string => {
  const date = new Date(time);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};

/**
 * Les instructions d'un script de migration tel que Prisma l'écrit : une par
 * point-virgule en fin de ligne, les commentaires de tête à part. Ces scripts
 * sont figés et n'ont ni déclencheur ni bloc : un découpage faux y échouerait
 * à la première instruction, jamais en silence.
 */
function statementsOf(sql: string): string[] {
  const lines = sql.split(/\r?\n/u).filter((line) => !line.trimStart().startsWith('--'));
  return lines
    .join('\n')
    .split(/;\s*\n/u)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Une base SQLite neuve, son schéma venu de l'historique des migrations, appliquées dans l'ordre. */
function createSqliteSchema(file: string): void {
  const dir = join(BOT_DIR, 'prisma/migrations-sqlite');
  const db = new DatabaseSync(file);
  try {
    for (const name of readdirSync(dir)
      .filter((entry) => /^\d{14}_/u.test(entry))
      .sort()) {
      for (const statement of statementsOf(readFileSync(join(dir, name, 'migration.sql'), 'utf8'))) db.prepare(statement).run();
    }
  } finally {
    db.close();
  }
}

interface Fixture {
  prisma: PrismaService;
  /** Vide toutes les tables de modèles (l'historique des migrations reste). */
  reset(): Promise<void>;
}

/** Une base prête : service réel, connecté par son boot (garde-fou, dialecte, connexion). */
async function fixtureOf(url: string): Promise<Fixture> {
  const prisma = new PrismaService({ DATABASE_URL: url } as never);
  await prisma.onBoot().catch((error: unknown) => {
    throw new Error(
      `Base de test non préparée. ` +
        (url.startsWith('file:') ? '' : 'Lance d\u0027abord : DATABASE_URL=<adresse de test> pnpm --filter 10cordes-bot db:deploy. ') +
        (error instanceof Error ? error.message : String(error)),
    );
  });
  return {
    prisma,
    reset: async () => {
      for (const model of DELETE_ORDER) {
        await (prisma as unknown as Record<string, { deleteMany(): Promise<unknown> }>)[model.name]?.deleteMany();
      }
    },
  };
}

/** Les mêmes données sur les deux moteurs : serveurs, fournisseurs à secret, routes, audit sur deux jours, voix, fiches, appels au modèle. */
async function seed(prisma: PrismaService): Promise<void> {
  await prisma.guild.createMany({ data: [{ id: GUILD }, { id: OTHER_GUILD }] });
  await prisma.guildProvider.create({
    data: { id: 'prov-a', guildId: GUILD, slug: 'test-a', displayName: 'Test A', protocol: 'openai-chat', baseUrl: 'https://api.example.test/v1', encryptedApiKey: TEST_SECRET },
  });
  await prisma.capabilityRoute.createMany({
    data: [
      { id: 'route-1', guildId: GUILD, capability: 'chat.default', providerId: 'prov-a', modelId: 'model-a' },
      { id: 'route-2', guildId: GUILD, capability: 'music.generate', providerId: 'prov-a', modelId: 'model-a', fallbackProviderId: 'prov-a' },
    ],
  });
  await prisma.integrationConfig.create({ data: { id: 'llm', apiKey: TEST_SECRET } });
  await prisma.auditLog.createMany({
    data: [
      { id: 'a1', guildId: GUILD, action: 'message.created', actorId: USER, createdAt: new Date(NOW - 10 * MINUTE) },
      { id: 'a2', guildId: GUILD, action: 'message.created', actorId: USER, createdAt: new Date(NOW - 20 * MINUTE) },
      { id: 'a3', guildId: GUILD, action: 'message.created', actorId: OTHER_USER, createdAt: new Date(NOW - 2 * DAY) },
      { id: 'a4', guildId: GUILD, action: 'member.joined', actorId: OTHER_USER, createdAt: new Date(NOW - DAY) },
      { id: 'a5', guildId: GUILD, action: 'member.left', actorId: USER, createdAt: new Date(NOW - 31 * DAY) },
      { id: 'a6', guildId: OTHER_GUILD, action: 'message.created', actorId: USER, createdAt: new Date(NOW - 5 * MINUTE) },
    ],
  });
  await prisma.memberActivity.createMany({
    data: [
      { guildId: GUILD, userId: USER, voiceMinutes: 12 },
      { guildId: GUILD, userId: OTHER_USER, voiceMinutes: 5 },
    ],
  });
  await prisma.agentRecord.createMany({
    data: [
      { id: 'r1', guildId: GUILD, collection: 'quotes', data: '{"text":"Un Parisien a Paris"}', createdBy: USER },
      { id: 'r2', guildId: GUILD, collection: 'quotes', data: '{"text":"rien a voir"}', createdBy: USER },
      { id: 'r3', guildId: OTHER_GUILD, collection: 'quotes', data: '{"text":"paris ailleurs"}', createdBy: USER },
    ],
  });
  await prisma.memberMemoryProfile.createMany({ data: [{ guildId: GUILD, userId: USER, text: 'fiche de test' }, { guildId: OTHER_GUILD, userId: USER, text: 'autre serveur, même membre' }] });
  await prisma.llmUsageRow.createMany({
    data: [
      { guildId: GUILD, cause: 'reply', provider: 'test-a', model: 'model-a', promptTokens: 100, completionTokens: 50, ms: 900, createdAt: new Date(NOW - 10 * MINUTE) },
      { guildId: GUILD, cause: 'reply', provider: 'test-a', model: 'model-a', promptTokens: 300, completionTokens: 100, ms: 500, createdAt: new Date(NOW - 2 * DAY) },
      { guildId: GUILD, cause: 'reply', provider: 'test-b', model: 'model-b', promptTokens: 100, completionTokens: 50, ms: 100, ok: false, fallback: true, createdAt: new Date(NOW - 20 * MINUTE) },
      { guildId: GUILD, cause: 'reply', provider: 'test-a', model: 'model-a', promptTokens: 10_000, createdAt: new Date(NOW - 40 * DAY) },
      { guildId: OTHER_GUILD, cause: 'reply', provider: 'test-a', model: 'model-a', promptTokens: 50_000, createdAt: new Date(NOW - 10 * MINUTE) },
    ],
  });
}

const engines = [
  { engine: 'sqlite' as const, url: '' },
  ...(TEST_POSTGRES ? [{ engine: 'postgresql' as const, url: TEST_POSTGRES }] : []),
];

let sqliteDir = '';
const fixtures = new Map<string, Fixture>();

beforeAll(async () => {
  sqliteDir = mkdtempSync(join(tmpdir(), '10cordes-integration-'));
  engines[0]!.url = `file:${join(sqliteDir, 'integration.db')}`;
  createSqliteSchema(join(sqliteDir, 'integration.db'));
  fixtures.set('sqlite', await fixtureOf(engines[0]!.url));
  if (!TEST_POSTGRES) return;
  fixtures.set('postgresql', await fixtureOf(TEST_POSTGRES));
}, 60_000);

afterAll(async () => {
  for (const fixture of fixtures.values()) await fixture.prisma.$disconnect();
  fixtures.clear();
  if (!sqliteDir) return;
  for (let attempt = 0; attempt < 10 && existsSync(sqliteDir); attempt += 1) {
    try {
      rmSync(sqliteDir, { recursive: true, force: true });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe.each(engines.map((entry) => ({ engine: entry.engine })))('intégration sur $engine', ({ engine }) => {
  /** La base de test, vidée : chaque test part de zéro, sur les mêmes données. */
  const empty = async () => {
    const found = fixtures.get(engine);
    if (!found) throw new Error(`Base de test ${engine} non préparée.`);
    await found.reset();
    return found.prisma;
  };

  it('le service de base démarre par son boot, sur le dialecte de son moteur', async () => {
    const prisma = await empty();
    expect(prisma.dialect.provider).toBe(engine);
    // L'adresse de la base SQLite n'est connue qu'après sa création, et le service la rend résolue : barres obliques partout.
    expect(prisma.databaseUrl).toBe(engine === 'sqlite' ? engines[0]!.url.split('\\').join('/') : TEST_POSTGRES);
  });

  it('un aller-retour garde les instants à la milliseconde, les booléens et les valeurs absentes', async () => {
    const prisma = await empty();
    const at = new Date('2026-11-25T22:45:10.456Z');
    await prisma.guild.create({ data: { id: GUILD } });
    await prisma.auditLog.create({ data: { id: 'rt', guildId: GUILD, action: 'test', actorId: null, targetId: null, createdAt: at } });
    await prisma.guildProvider.create({
      data: { id: 'rt-p', guildId: GUILD, slug: 'rt', displayName: 'RT', protocol: 'openai-chat', baseUrl: 'https://api.example.test', encryptedApiKey: null, enabled: false },
    });
    const row = await prisma.auditLog.findUniqueOrThrow({ where: { id: 'rt' } });
    const provider = await prisma.guildProvider.findUniqueOrThrow({ where: { id: 'rt-p' } });
    expect(row.createdAt.getTime()).toBe(at.getTime());
    expect(row.actorId).toBeNull();
    expect(provider.enabled).toBe(false);
    expect(provider.encryptedApiKey).toBeNull();
  }, 30_000);

  it('le résumé des appels au modèle compte la fenêtre, par modèle et par jour local', async () => {
    vi.stubEnv('TZ', SYSTEM_ZONE);
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const prisma = await empty();
    await seed(prisma);
    const summary = await new UsageReaderService(prisma).summary(GUILD, '7d');
    expect(summary).toMatchObject({ window: '7d', turns: 3, promptTokens: 500, completionTokens: 200, errors: 1, fallbacks: 1 });
    expect(summary.byModel[0]).toEqual({ provider: 'test-a', model: 'model-a', turns: 2, promptTokens: 400, completionTokens: 150, errors: 0, fallbacks: 0 });
    expect(summary.byModel[1]).toEqual({ provider: 'test-b', model: 'model-b', turns: 1, promptTokens: 100, completionTokens: 50, errors: 1, fallbacks: 1 });
    expect(summary.byDay.filter((entry) => entry.turns > 0)).toEqual([
      { day: localDay(NOW - 2 * DAY), turns: 1, tokens: 400 },
      { day: localDay(NOW), turns: 2, tokens: 300 },
    ]);
  }, 30_000);

  it('le résumé d’activité du serveur agrège l’audit par jour local, les arrivées et départs, et les meilleurs membres', async () => {
    vi.stubEnv('TZ', SYSTEM_ZONE);
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const prisma = await empty();
    await seed(prisma);
    const result = await summarizeActivity(prisma, GUILD, 30);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      days: 30,
      totalMessages: 3,
      joined: 1,
      // Le départ date de 31 jours : hors fenêtre.
      left: 0,
      perDay: [
        { day: localDay(NOW - 2 * DAY), messages: 1 },
        { day: localDay(NOW), messages: 2 },
      ],
      topMembers: [
        { userId: USER, messages: 2, voiceMinutesCumul: 12 },
        { userId: OTHER_USER, messages: 1, voiceMinutesCumul: 5 },
      ],
    });
    // La couverture remonte au plus ancien message du serveur, fenêtre ou non.
    expect(String(result.data?.coverageSince)).toBe(new Date(NOW - 2 * DAY).toISOString());
  }, 30_000);

  it('la recherche de fiches ignore la casse, et ne lit que son serveur', async () => {
    const prisma = await empty();
    await seed(prisma);
    const rows = await prisma.agentRecord.findMany({ where: { guildId: GUILD, collection: 'quotes', data: prisma.dialect.textContains('PARIS') }, orderBy: { createdAt: 'desc' } });
    expect(rows.map((row) => row.id)).toEqual(['r1']);
  }, 30_000);
});

describe.skipIf(!TEST_POSTGRES)('migration d’une base SQLite vers PostgreSQL', () => {
  /** Les tests de ce bloc s'enchaînent : la source est remplie par le premier, la cible est vidée avant lui. */
  const migrate = async (dryRun: boolean, onProgress?: (line: string) => void) => {
    const source = fixtures.get('sqlite')?.prisma;
    const target = fixtures.get('postgresql')?.prisma;
    if (!source || !target) throw new Error('Bases de test non préparées.');
    return new SqliteToPostgresMigrator(readerOf(source), targetOf(target), MODELS, 3).run({
      sourceTables: await sqliteTablesOf(source),
      dryRun,
      onProgress,
    });
  };

  it('copie par lots, dans l’ordre des clés étrangères, en gardant les instants et les secrets octet pour octet', async () => {
    await fixtures.get('sqlite')?.reset();
    await fixtures.get('postgresql')?.reset();
    await seed(fixtures.get('sqlite')!.prisma);
    const progress: string[] = [];
    const report = await migrate(false, (line) => progress.push(line));
    // 2 serveurs, 1 fournisseur, 2 routes, 1 intégration, 6 audits, 2 voix, 3 fiches, 2 profils, 5 appels.
    expect(report.totalRows).toBe(24);
    expect(report.totalInserted).toBe(24);
    expect(report.secretRows).toBe(2);
    // Six lignes d'audit par lots de trois.
    expect(report.tables.find((table) => table.table === 'audit_logs')).toMatchObject({ sourceRows: 6, inserted: 6, batches: 2 });
    // Les fournisseurs sont copiés avant les routes qui les référencent.
    expect(progress.findIndex((line) => line.startsWith('copie') && line.includes('guild_providers'))).toBeLessThan(progress.findIndex((line) => line.startsWith('copie') && line.includes('capability_routes')));
    const target = fixtures.get('postgresql')!.prisma;
    const audit = await target.auditLog.findUniqueOrThrow({ where: { id: 'a1' } });
    expect(audit.createdAt.getTime()).toBe(NOW - 10 * MINUTE);
    expect((await target.integrationConfig.findUniqueOrThrow({ where: { id: 'llm' } })).apiKey).toBe(TEST_SECRET);
    expect((await target.guildProvider.findUniqueOrThrow({ where: { id: 'prov-a' } })).encryptedApiKey).toBe(TEST_SECRET);
    expect(await target.memberMemoryProfile.count()).toBe(2);
  }, 60_000);

  it('est sans effet à la relance, puis signale une ligne de la cible qui diffère', async () => {
    const again = await migrate(false);
    expect(again.totalInserted).toBe(0);
    expect(again.totalRows).toBe(24);
    await fixtures.get('postgresql')!.prisma.integrationConfig.update({ where: { id: 'llm' }, data: { label: 'modifié dans la cible' } });
    await expect(migrate(false)).rejects.toThrow(MigrationVerifyError);
  }, 60_000);

  it('un essai à sec ne copie rien', async () => {
    await fixtures.get('postgresql')?.reset();
    const dry = await migrate(true);
    expect(dry.totalRows).toBe(24);
    expect(dry.totalInserted).toBe(0);
    expect(await fixtures.get('postgresql')!.prisma.auditLog.count()).toBe(0);
  }, 60_000);
});
