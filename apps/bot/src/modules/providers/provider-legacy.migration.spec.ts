import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindIntegrations } from '../integrations/integration.runtime';
import type { IntegrationService } from '../integrations/integration.service';
import { INSTANCE_SOURCE, ProviderLegacyMigration, slugFromHost } from './provider-legacy.migration';
import type { GuildProviderService, ResolvedRoute } from './provider-store.service';
import type { ProviderConfig } from './provider.types';

/**
 * Migration ADDITIVE des intégrations d'instance vers des fournisseurs du
 * serveur, et alignement des copies quand l'instance change. Ce que fixent
 * ces tests, né d'un risque réel : une clé tournée par le owner ne doit
 * laisser aucun serveur migré sur l'ancienne.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';
const DB = 'db' as const;

type Resolved = { id: string; config: Record<string, string>; source: 'db' | 'env' | 'none' };

const LLM = resolved({ apiKey: `${KEY}-llm`, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' });

function resolved(config: Record<string, string>, source: Resolved['source'] = DB): Resolved {
  return { id: 'x', config, source };
}

function harness(options: { integrations?: Record<string, Resolved>; marked?: boolean; env?: Record<string, string>; copies?: ProviderConfig[]; routes?: ResolvedRoute[] } = {}) {
  const prisma = { auditLog: { findFirst: vi.fn(async () => (options.marked ? { id: 'marker' } : null)) } };
  const audit = { record: vi.fn() };
  const env = { LLM_API_URL: undefined, LLM_API_KEY: undefined, LLM_MODEL: undefined, ...options.env };
  const store = {
    upsert: vi.fn(async (_guildId: string, input: { slug: string; displayName?: string }) => ({ id: `id-${input.slug}`, slug: input.slug, displayName: input.displayName ?? input.slug })),
    bindRoute: vi.fn(async (_guildId: string, _capability: string, _input?: unknown, _actorId?: string): Promise<void> => undefined),
    listMarked: vi.fn(async () => options.copies ?? []),
    routes: vi.fn(async () => options.routes ?? []),
  };
  const integrations = { get: vi.fn(async (id: string): Promise<Resolved> => options.integrations?.[id] ?? { id, config: {}, source: 'none' }) };
  bindIntegrations(integrations as unknown as IntegrationService);
  const migration = new ProviderLegacyMigration(prisma as never, audit as never, env as never, store as unknown as GuildProviderService);
  return { migration, store, audit, prisma };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProviderLegacyMigration · une seule fois par serveur', () => {
  it('la première résolution migre, la seconde ne fait plus rien', async () => {
    const { migration, store, audit, prisma } = harness({ integrations: { llm: LLM } });
    await migration.ensureMigrated(GUILD);
    await migration.ensureMigrated(GUILD);
    expect(prisma.auditLog.findFirst).toHaveBeenCalledTimes(1);
    expect(store.upsert).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('un serveur déjà migré (trace d\u0027audit) n\u0027est pas migré deux fois', async () => {
    const { migration, store, audit } = harness({ integrations: { llm: LLM }, marked: true });
    await migration.ensureMigrated(GUILD);
    expect(store.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('ProviderLegacyMigration · intégrations d\u0027instance vers fournisseurs', () => {
  it('le fournisseur IA d\u0027instance devient un fournisseur du serveur, nommé d\u0027après son hôte, avec ses trois routes de conversation', async () => {
    const { migration, store, audit } = harness({ integrations: { llm: LLM } });
    await migration.ensureMigrated(GUILD);
    expect(store.upsert).toHaveBeenCalledWith(
      GUILD,
      expect.objectContaining({
        slug: 'deepseek-official',
        protocol: 'openai-chat',
        baseUrl: 'https://api.deepseek.com',
        apiKey: `${KEY}-llm`,
        extraConfig: { _source: INSTANCE_SOURCE, _model: 'deepseek-flash' },
      }),
      'system',
    );
    expect(store.bindRoute.mock.calls.map(([_, capability]) => capability)).toEqual(['chat.default', 'chat.reasoning', 'chat.ingestion']);
    expect(store.bindRoute).toHaveBeenCalledWith(GUILD, 'chat.default', { providerId: 'id-deepseek-official', modelId: 'deepseek-flash' }, 'system');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ guildId: GUILD, action: 'provider.legacy_migrated', actorId: 'system', metadata: { providers: ['deepseek-official'], routes: 3 } }));
  });

  it('PixelLab et kie.ai suivent, chacun avec sa capacité', async () => {
    const { migration, store, audit } = harness({
      integrations: {
        llm: LLM,
        pixellab: resolved({ apiKey: `${KEY}-pixel` }),
        kie: resolved({ apiKey: `${KEY}-kie`, model: 'V6_MINI' }),
      },
    });
    await migration.ensureMigrated(GUILD);
    expect(store.upsert).toHaveBeenCalledWith(GUILD, expect.objectContaining({ slug: 'pixellab', protocol: 'generic-http', baseUrl: 'https://api.pixellab.ai' }), 'system');
    expect(store.upsert).toHaveBeenCalledWith(GUILD, expect.objectContaining({ slug: 'kie-main', protocol: 'kie-unified', baseUrl: 'https://api.kie.ai' }), 'system');
    expect(store.bindRoute).toHaveBeenCalledWith(GUILD, 'image.generate', { providerId: 'id-pixellab', modelId: 'create-image-pixflux' }, 'system');
    expect(store.bindRoute).toHaveBeenCalledWith(GUILD, 'music.generate', { providerId: 'id-kie-main', modelId: 'V6_MINI' }, 'system');
    expect(store.bindRoute).toHaveBeenCalledWith(GUILD, 'custom.kie-image', { providerId: 'id-kie-main', modelId: 'z-image' }, 'system');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { providers: ['deepseek-official', 'pixellab', 'kie-main'], routes: 6 } }));
  });

  it('sans ligne en base, les variables d\u0027environnement servent de source', async () => {
    const { migration, store } = harness({ env: { LLM_API_URL: 'https://openrouter.ai/api/v1', LLM_API_KEY: `${KEY}-env`, LLM_MODEL: 'openai/gpt-4o-mini' } });
    await migration.ensureMigrated(GUILD);
    expect(store.upsert).toHaveBeenCalledWith(GUILD, expect.objectContaining({ slug: 'openrouter', apiKey: `${KEY}-env`, extraConfig: { _source: INSTANCE_SOURCE, _model: 'openai/gpt-4o-mini' } }), 'system');
    expect(store.bindRoute).toHaveBeenCalledWith(GUILD, 'chat.default', { providerId: 'id-openrouter', modelId: 'openai/gpt-4o-mini' }, 'system');
  });

  it('sans aucune configuration, rien n\u0027est créé mais le serveur est marqué', async () => {
    const { migration, store, audit } = harness({});
    await migration.ensureMigrated(GUILD);
    expect(store.upsert).not.toHaveBeenCalled();
    expect(store.bindRoute).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { providers: [], routes: 0 } }));
  });
});

describe('ProviderLegacyMigration · alignement des copies sur l\u0027instance', () => {
  const instance = resolved({ apiKey: `${KEY}-new`, baseUrl: 'https://api.deepseek.com/', model: 'deepseek-v4' });

  function copy(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
      id: 'copy-1',
      guildId: GUILD,
      slug: 'deepseek-official',
      displayName: 'IA (api.deepseek.com)',
      protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      authType: 'bearer',
      authHeaderName: null,
      apiKey: `${KEY}-old`,
      customHeaders: {},
      extraConfig: { _source: INSTANCE_SOURCE, _model: 'deepseek-flash' },
      models: [],
      enabled: true,
      ...overrides,
    };
  }

  const bound = (capability: string, provider: ProviderConfig, modelId: string): ResolvedRoute => ({ capability: capability as ResolvedRoute['capability'], provider, modelId, fallback: null, params: { temperature: 0.4 } });

  it('une copie identique à l\u0027instance n\u0027est pas réécrite', async () => {
    const current = copy({ apiKey: `${KEY}-new`, baseUrl: 'https://api.deepseek.com/', extraConfig: { _source: INSTANCE_SOURCE, _model: 'deepseek-v4' } });
    const { migration, store } = harness({ integrations: { llm: instance }, copies: [current] });
    expect(await migration.reconcileInstance()).toEqual({ checked: 1, updated: 0 });
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('une clé tournée : la copie reçoit la nouvelle clé, garde sa marque, et ses routes suivent le modèle d\u0027instance', async () => {
    const current = copy();
    const { migration, store } = harness({
      integrations: { llm: instance },
      copies: [current],
      routes: [bound('chat.default', current, 'deepseek-flash'), bound('chat.reasoning', current, 'mon-modele'), bound('music.generate', { ...current, id: 'other' }, 'V6_MINI')],
    });
    expect(await migration.reconcileInstance()).toEqual({ checked: 1, updated: 1 });
    expect(store.upsert).toHaveBeenCalledTimes(1);
    expect(store.upsert).toHaveBeenCalledWith(
      GUILD,
      expect.objectContaining({ slug: 'deepseek-official', apiKey: `${KEY}-new`, baseUrl: 'https://api.deepseek.com/', extraConfig: { _source: INSTANCE_SOURCE, _model: 'deepseek-v4' }, enabled: true }),
      'system',
    );
    // Seule la route restée sur le modèle d'origine suit : celle rebindée par un administrateur garde son modèle.
    expect(store.bindRoute).toHaveBeenCalledTimes(1);
    expect(store.bindRoute).toHaveBeenCalledWith(GUILD, 'chat.default', { providerId: 'copy-1', modelId: 'deepseek-v4', fallbackProviderId: null, fallbackModelId: null, params: { temperature: 0.4 } }, 'system');
  });

  it('sans configuration d\u0027instance, il n\u0027y a rien à aligner', async () => {
    const { migration, store } = harness({ copies: [copy()] });
    expect(await migration.reconcileInstance()).toEqual({ checked: 0, updated: 0 });
    expect(store.listMarked).not.toHaveBeenCalled();
  });
});

describe('slugFromHost', () => {
  it.each([
    ['api.deepseek.com', 'deepseek-official'],
    ['api.openrouter.ai', 'openrouter'],
    ['generativelanguage.googleapis.com', 'generativelanguage'],
    ['openai.com', 'openai'],
    ['', 'fournisseur'],
  ])('%s → %s', (host, slug) => {
    expect(slugFromHost(host)).toBe(slug);
  });
});
