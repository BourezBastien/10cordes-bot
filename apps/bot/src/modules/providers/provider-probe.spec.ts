import { describe, expect, it, vi } from 'vitest';
import { probeConnection } from './provider-probe';
import { buildProviderTools } from './provider.tools';
import { ProviderError, type ConnectionCheckResult, type ProviderConfig, type ProviderModel } from './provider.types';

/**
 * Contrôle de connexion et rafraîchissement du catalogue : le chemin commun
 * aux tools `provider.*` et au dashboard. Ce que fixent ces tests : un
 * contrôle qui échoue est un résultat qui ne touche pas au catalogue, une
 * erreur levée par l'adaptateur remonte à l'appelant, et les tools disent
 * toujours la même chose.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';
const ACTOR = '1550000000000000002';
const CONNECTED = 'Connecté : 2 modèle(s).';
const LISTED: ProviderModel[] = [{ id: 'a', kind: 'chat' }, { id: 'b', kind: 'chat' }];

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    guildId: GUILD,
    slug: 'main',
    displayName: 'Main',
    protocol: 'openai-chat',
    baseUrl: 'https://api.example.com/v1',
    authType: 'bearer',
    authHeaderName: null,
    apiKey: KEY,
    customHeaders: {},
    extraConfig: {},
    models: [],
    enabled: true,
    ...overrides,
  };
}

function harness(options: { check?: ConnectionCheckResult; throws?: unknown; models?: ProviderModel[]; catalogUnreadable?: boolean } = {}) {
  const adapter = {
    testConnection: vi.fn(async (): Promise<ConnectionCheckResult> => {
      if (options.throws !== undefined) throw options.throws;
      return options.check ?? { ok: true, summary: CONNECTED, modelsFound: 2 };
    }),
    discoverModels: vi.fn(async (): Promise<ProviderModel[]> => {
      if (options.catalogUnreadable) throw new Error('catalogue illisible');
      return options.models ?? LISTED;
    }),
  };
  const store = { saveModels: vi.fn(async () => undefined), get: vi.fn(async () => config()) };
  const registry = { resolve: vi.fn(() => adapter) };
  return { adapter, store, registry, deps: { store, registry } };
}

describe('probeConnection', () => {
  it('connexion passée : le catalogue découvert est retenu', async () => {
    const { deps, store } = harness();
    await expect(probeConnection(deps as never, config())).resolves.toEqual({ ok: true, summary: CONNECTED, modelsFound: 2 });
    expect(store.saveModels).toHaveBeenCalledWith(GUILD, 'provider-1', LISTED);
  });

  it('rien n\u0027est retenu quand le fournisseur ne liste aucun modèle', async () => {
    const { deps, store } = harness({ models: [] });
    await expect(probeConnection(deps as never, config())).resolves.toEqual({ ok: true, summary: CONNECTED, modelsFound: 0 });
    expect(store.saveModels).not.toHaveBeenCalled();
  });

  it('un catalogue illisible ne fait pas échouer le contrôle', async () => {
    const { deps, store } = harness({ catalogUnreadable: true });
    await expect(probeConnection(deps as never, config())).resolves.toEqual({ ok: true, summary: CONNECTED, modelsFound: 0 });
    expect(store.saveModels).not.toHaveBeenCalled();
  });

  it('un contrôle qui échoue est un résultat : le catalogue n\u0027est pas touché', async () => {
    const { deps, store, adapter } = harness({ check: { ok: false, summary: 'HTTP 401', modelsFound: 0 } });
    const probe = await probeConnection(deps as never, config());
    expect(probe).toMatchObject({ ok: false, summary: 'HTTP 401', modelsFound: 0 });
    expect(probe.ok === false && probe.error).toBeInstanceOf(Error);
    expect(adapter.discoverModels).not.toHaveBeenCalled();
    expect(store.saveModels).not.toHaveBeenCalled();
  });

  it('une erreur levée par l\u0027adaptateur remonte telle quelle : c\u0027est à l\u0027appelant d\u0027en décider', async () => {
    const failure = new ProviderError('HTTP 429', 'rate-limit', 429);
    const { deps, store } = harness({ throws: failure });
    await expect(probeConnection(deps as never, config())).rejects.toBe(failure);
    expect(store.saveModels).not.toHaveBeenCalled();
  });
});

describe('tools provider.* · contrôle et catalogue', () => {
  const ctx = (): never => ({ guildId: GUILD, userId: ACTOR }) as never;
  const tool = (deps: ReturnType<typeof harness>['deps'], id: string) => buildProviderTools(deps as never).find((candidate) => candidate.name === id);

  it('un contrôle réussi annonce le catalogue enregistré', async () => {
    const h = harness();
    expect(await tool(h.deps, 'provider.test')?.handler({ provider: 'main' }, ctx())).toEqual({ ok: true, summary: `${CONNECTED} Catalogue enregistré.`, data: { modelsFound: 2 } });
    expect(h.store.saveModels).toHaveBeenCalledWith(GUILD, 'provider-1', LISTED);
  });

  it('un contrôle qui échoue prévient que le fournisseur est injoignable ; une erreur levée reste un test impossible', async () => {
    const failed = harness({ check: { ok: false, summary: 'HTTP 401', modelsFound: 0 } });
    expect(await tool(failed.deps, 'provider.test')?.handler({ provider: 'main' }, ctx())).toEqual({ ok: false, summary: 'Fournisseur enregistré mais injoignable : HTTP 401' });

    const thrown = harness({ throws: new ProviderError('HTTP 429', 'rate-limit', 429) });
    expect(await tool(thrown.deps, 'provider.test')?.handler({ provider: 'main' }, ctx())).toEqual({ ok: false, summary: 'Test impossible : HTTP 429' });
  });

  it('sans clé enregistrée, rien n\u0027est testé', async () => {
    const h = harness();
    h.store.get.mockResolvedValue(config({ apiKey: null }));
    expect(await tool(h.deps, 'provider.test')?.handler({ provider: 'main' }, ctx())).toEqual({ ok: false, summary: 'Aucune clé enregistrée pour **main**.' });
    expect(h.adapter.testConnection).not.toHaveBeenCalled();
  });
});
