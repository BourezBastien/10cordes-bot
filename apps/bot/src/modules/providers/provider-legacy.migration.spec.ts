import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindIntegrations } from '../integrations/integration.runtime';
import type { IntegrationService, ResolvedIntegration } from '../integrations/integration.service';
import { fakeDb } from '../../test/fake-db';
import { INSTANCE_SOURCES } from './instance-defaults';
import { ProviderLegacyMigration } from './provider-legacy.migration';
import { GuildProviderService } from './provider-store.service';
import { ProviderError } from './provider.types';

/**
 * Réglages par défaut de l'instance, appliqués à chaque serveur : les
 * fournisseurs IA copiés de l'instance (DeepSeek, kie.ai) et les routes qui
 * vont avec, écrits par le VRAI store dans une base en mémoire. Ce que fixent
 * ces tests, né d'un risque réel : une clé tournée par le owner ne doit
 * laisser aucune copie sur l'ancienne ; un fournisseur ou une route créés
 * par un administrateur ne sont jamais touchés.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';
const OTHER = '1550000000000000002';
const SECRETS = { token: 'x', ENCRYPTION_SECRET: KEY } as never;

type Resolved = { id: string; config: Record<string, string>; source: ResolvedIntegration['source'] };
type Integrations = Record<string, Resolved>;

const LLM: Resolved = { id: 'llm', config: { apiKey: `${KEY}-llm`, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }, source: 'db' };
const KIE: Resolved = { id: 'kie', config: { apiKey: `${KEY}-kie`, model: 'V6_MINI' }, source: 'db' };
const MARKER = 'provider.legacy_migrated';

function harness(options: { integrations?: Integrations; guilds?: string[]; marked?: string[] } = {}) {
  const db = fakeDb();
  for (const id of options.guilds ?? [GUILD]) db.guild.rows.set(id, { id });
  const marked = new Set(options.marked ?? []);
  db.auditLog.findFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) =>
    marked.has(`${args.where?.guildId}:${args.where?.action}`) ? { id: 'marker' } : null,
  );
  const audit = { record: vi.fn() };
  const store = new GuildProviderService(db as never, audit as never, SECRETS);
  const integrations = { get: vi.fn(async (id: string): Promise<Resolved> => options.integrations?.[id] ?? { id, config: {}, source: 'none' }) };
  bindIntegrations(integrations as unknown as IntegrationService);
  const migration = new ProviderLegacyMigration(db as never, audit as never, store);
  return { db, store, audit, migration, integrations };
}

/** Capacité → fournisseur / modèle, tel que le routeur le lit. */
async function targets(store: GuildProviderService, guildId: string): Promise<Record<string, string>> {
  const routes = await store.routes(guildId);
  return Object.fromEntries(routes.map((route) => [route.capability, `${route.provider.slug}/${route.modelId}`]));
}

const slugsOf = async (store: GuildProviderService, guildId: string) => (await store.list(guildId)).map((provider) => provider.slug).sort();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProviderLegacyMigration · premiers réglages d\u0027un serveur', () => {
  it('les fournisseurs d\u0027instance et leurs routes sont écrits en base, le serveur est marqué une seule fois', async () => {
    const { db, store, migration, audit } = harness({ integrations: { llm: LLM, kie: KIE } });
    await migration.ensureMigrated(GUILD);
    await migration.ensureMigrated(GUILD);

    expect(await slugsOf(store, GUILD)).toEqual(['deepseek-official', 'kie-ai']);
    expect(db.auditLog.findFirst).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ guildId: GUILD, action: MARKER, actorId: 'system', metadata: { providers: ['deepseek-official', 'kie-ai'], routes: 6, removed: 0 } }));
  });

  it('ce qui est écrit : clé chiffrée, marque d\u0027instance, conversation sur le fournisseur IA, médias sur les modèles du catalogue kie.ai', async () => {
    const { db, store, migration } = harness({ integrations: { llm: LLM, kie: KIE } });
    await migration.applyDefaults(GUILD);

    const deepseek = (await store.list(GUILD)).find((provider) => provider.slug === 'deepseek-official');
    expect(deepseek).toMatchObject({ protocol: 'openai-chat', baseUrl: 'https://api.deepseek.com', displayName: 'IA (api.deepseek.com)', apiKey: `${KEY}-llm` });
    expect(deepseek?.extraConfig).toEqual({
      _source: INSTANCE_SOURCES.llm,
      _models: { 'chat.default': 'deepseek-flash', 'chat.reasoning': 'deepseek-flash', 'chat.ingestion': 'deepseek-flash' },
      _model: 'deepseek-flash',
    });
    const stored = [...db.guildProvider.rows.values()].find((row) => row.slug === 'deepseek-official');
    expect(String(stored?.encryptedApiKey).startsWith('v1:')).toBe(true);
    expect(stored?.encryptedApiKey).not.toContain(KEY);

    // Le catalogue de l'adaptateur tient lieu de liste initiale de kie.ai.
    expect((await store.get(GUILD, 'kie-ai'))?.models.map((model) => model.id)).toEqual(['V6_MINI', 'V6', 'z-image']);
    expect(await targets(store, GUILD)).toEqual({
      'chat.default': 'deepseek-official/deepseek-flash',
      'chat.reasoning': 'deepseek-official/deepseek-flash',
      'chat.ingestion': 'deepseek-official/deepseek-flash',
      'image.generate': 'kie-ai/z-image',
      'image.edit': 'kie-ai/z-image',
      'music.generate': 'kie-ai/V6_MINI',
    });
  });

  it('une famille que le catalogue de kie.ai ne déclare pas (voix, vidéo) reste à lier, et la recherche web n\u0027est liée nulle part', async () => {
    const { store, migration } = harness({ integrations: { llm: LLM, kie: KIE } });
    await migration.applyDefaults(GUILD);
    const routed = Object.keys(await targets(store, GUILD));
    expect(routed).not.toContain('tts.speak');
    expect(routed).not.toContain('video.generate');
    expect(routed).not.toContain('web.search');
  });

  it('un serveur déjà marqué n\u0027est pas traité deux fois', async () => {
    const { db, store, migration } = harness({ integrations: { llm: LLM, kie: KIE }, marked: [`${GUILD}:${MARKER}`] });
    await migration.ensureMigrated(GUILD);
    expect(db.guildProvider.findMany).not.toHaveBeenCalled();
    expect(await slugsOf(store, GUILD)).toEqual([]);
  });

  it('sans configuration d\u0027instance, rien n\u0027est écrit et le serveur est quand même marqué', async () => {
    const { store, migration, audit } = harness({});
    await migration.ensureMigrated(GUILD);
    expect(await slugsOf(store, GUILD)).toEqual([]);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: MARKER, metadata: { providers: [], routes: 0, removed: 0 } }));
  });

  it('une étape en échec n\u0027arrête pas les suivantes', async () => {
    const { store, migration } = harness({ integrations: { llm: LLM, kie: KIE } });
    const original = store.upsert.bind(store);
    vi.spyOn(store, 'upsert').mockImplementation(async (guildId, input, actorId) => {
      if (input.slug === 'deepseek-official') throw new ProviderError('Slug « deepseek-official » déjà pris.', 'invalid');
      return original(guildId, input, actorId);
    });
    expect(await migration.applyDefaults(GUILD)).toEqual({ providers: ['kie-ai'], routes: 3, removed: 0 });
    expect(await slugsOf(store, GUILD)).toEqual(['kie-ai']);
  });
});

describe('ProviderLegacyMigration · alignement des copies sur l\u0027instance', () => {
  it('une clé tournée et un nouveau modèle se propagent ; le réglage et les fournisseurs de l\u0027administrateur restent', async () => {
    const { store, migration, integrations } = harness({ integrations: { llm: LLM }, guilds: [GUILD, OTHER] });
    await migration.applyDefaults(GUILD);
    const deepseekId = (await store.get(GUILD, 'deepseek-official'))?.id;
    // L'administrateur a choisi son modèle de raisonnement, ajouté son fournisseur et lié une image dessus.
    await store.bindRoute(GUILD, 'chat.reasoning', { providerId: deepseekId ?? '', modelId: 'my-reasoner' }, 'admin');
    const own = await store.upsert(
      GUILD,
      { slug: 'openrouter', displayName: 'OpenRouter', protocol: 'openai-chat', baseUrl: 'https://openrouter.ai/api/v1', apiKey: `${KEY}-own` },
      'admin',
    );
    await store.bindRoute(GUILD, 'image.generate', { providerId: own.id, modelId: 'flux' }, 'admin');

    // L'instance change : clé tournée, modèle changé (kie.ai reste non configuré).
    const rotated: Resolved = { ...LLM, config: { ...LLM.config, apiKey: `${KEY}-rotated`, model: 'deepseek-v4' } };
    integrations.get.mockImplementation(async (id: string) => (id === 'llm' ? rotated : { id, config: {}, source: 'none' }));
    expect(await migration.reconcileInstance()).toEqual({ checked: 2, updated: 2 });

    const copy = (await store.list(GUILD)).find((provider) => provider.slug === 'deepseek-official');
    expect(copy).toMatchObject({ id: deepseekId, apiKey: `${KEY}-rotated` });
    expect(copy?.extraConfig).toMatchObject({ _source: INSTANCE_SOURCES.llm, _model: 'deepseek-v4' });
    expect((await store.list(GUILD)).find((provider) => provider.slug === 'openrouter')?.apiKey).toBe(`${KEY}-own`);
    expect(await slugsOf(store, GUILD)).toEqual(['deepseek-official', 'openrouter']);
    expect(await targets(store, GUILD)).toEqual({
      'chat.default': 'deepseek-official/deepseek-v4',
      'chat.reasoning': 'deepseek-official/my-reasoner',
      'chat.ingestion': 'deepseek-official/deepseek-v4',
      'image.generate': 'openrouter/flux',
    });
    expect(await targets(store, OTHER)).toEqual({
      'chat.default': 'deepseek-official/deepseek-v4',
      'chat.reasoning': 'deepseek-official/deepseek-v4',
      'chat.ingestion': 'deepseek-official/deepseek-v4',
    });
  });

  it('une copie déjà conforme n\u0027est pas réécrite', async () => {
    const { db, migration } = harness({ integrations: { llm: LLM, kie: KIE }, guilds: [GUILD] });
    await migration.applyDefaults(GUILD);
    db.guildProvider.upsert.mockClear();
    expect(await migration.reconcileInstance()).toEqual({ checked: 1, updated: 0 });
    expect(db.guildProvider.upsert).not.toHaveBeenCalled();
  });

  it('l\u0027ancienne copie kie-main devient kie-ai : même identifiant, ses routes conservées', async () => {
    const { store, migration } = harness({ integrations: { kie: KIE } });
    const legacy = await store.upsert(
      GUILD,
      { slug: 'kie-main', displayName: 'kie.ai (Suno)', protocol: 'kie-unified', baseUrl: 'https://api.kie.ai', apiKey: `${KEY}-old`, extraConfig: { _source: INSTANCE_SOURCES.kie } },
      'system',
    );
    await store.bindRoute(GUILD, 'music.generate', { providerId: legacy.id, modelId: 'V6' }, 'system');

    expect(await migration.applyDefaults(GUILD)).toEqual({ providers: ['kie-ai'], routes: 2, removed: 0 });
    const renamed = await store.get(GUILD, legacy.id);
    expect(renamed).toMatchObject({ id: legacy.id, slug: 'kie-ai', apiKey: `${KEY}-kie` });
    expect(await targets(store, GUILD)).toEqual({
      'music.generate': 'kie-ai/V6',
      'image.generate': 'kie-ai/z-image',
      'image.edit': 'kie-ai/z-image',
    });
  });

  it('un slug visé déjà pris par un fournisseur de l\u0027administrateur n\u0027est pas repris', async () => {
    const { store, migration } = harness({ integrations: { kie: KIE } });
    const own = await store.upsert(
      GUILD,
      { slug: 'kie-ai', displayName: 'Mon kie', protocol: 'kie-unified', baseUrl: 'https://proxy.example.test', apiKey: `${KEY}-own` },
      'admin',
    );
    await migration.applyDefaults(GUILD);
    const providers = await store.list(GUILD);
    expect(providers.map((provider) => provider.slug).sort()).toEqual(['kie-ai', 'kie-ai-instance']);
    expect(providers.find((provider) => provider.id === own.id)).toMatchObject({ displayName: 'Mon kie', apiKey: `${KEY}-own`, baseUrl: 'https://proxy.example.test' });
    expect(providers.find((provider) => provider.slug === 'kie-ai-instance')?.apiKey).toBe(`${KEY}-kie`);
  });

  it('les anciennes copies PixelLab, qui fut un fournisseur, sont retirées : c\u0027est une intégration', async () => {
    const { store, migration } = harness({ integrations: { llm: LLM } });
    const legacy = await store.upsert(
      GUILD,
      { slug: 'pixellab', displayName: 'PixelLab', protocol: 'generic-http', baseUrl: 'https://api.pixellab.ai', apiKey: `${KEY}-pixel`, extraConfig: { _source: INSTANCE_SOURCES.pixellab } },
      'system',
    );
    expect(await migration.applyDefaults(GUILD)).toEqual({ providers: ['deepseek-official'], routes: 3, removed: 1 });
    expect(await store.get(GUILD, legacy.id)).toBeNull();
  });
});
