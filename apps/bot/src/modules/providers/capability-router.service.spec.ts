import { describe, expect, it, vi } from 'vitest';
import { CapabilityRouterService } from './capability-router.service';
import type { AbstractProviderAdapter } from './provider-adapter';
import type { ResolvedRoute } from './provider-store.service';
import { ProviderError, type ProviderConfig } from './provider.types';

/**
 * Routeur des capacités. Ce que fixent ces tests, nés des décisions du moteur
 * multi-fournisseurs : une route choisit le modèle du tour, le fournisseur de
 * repli ne prend le relais que sur une erreur qui y invite (429, 5xx, délai),
 * jamais sur une clé refusée, et une capacité hors conversation retrouve la
 * clé de la route du serveur avant celle de l'instance.
 */

const GUILD = '1550000000000000001';
const ACTOR = '1550000000000000002';
// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';

function provider(id: string, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id,
    guildId: GUILD,
    slug: id,
    displayName: id,
    protocol: 'openai-chat',
    baseUrl: `https://${id}.example.com/v1`,
    authType: 'bearer',
    authHeaderName: null,
    apiKey: `${KEY}-${id}`,
    customHeaders: {},
    extraConfig: {},
    models: [],
    enabled: true,
    ...overrides,
  };
}

function route(capability: string, primary: ProviderConfig, fallback: ProviderConfig | null = null, modelId = 'model-a'): ResolvedRoute {
  return {
    capability: capability as ResolvedRoute['capability'],
    provider: primary,
    modelId,
    fallback: fallback ? { provider: fallback, modelId: 'model-b' } : null,
    params: {},
  };
}

const turn = () => ({ modelId: '', messages: [], tools: [], options: { userId: ACTOR, guildId: GUILD, cause: 'reply' as const } });

/** Adaptateur factice : `run` décide de la réussite ou de l'échec de chaque appel, chat comme exécution. */
function fakeAdapter(run: (modelId: string) => Promise<unknown>) {
  const done = async (modelId: string) => {
    await run(modelId);
    return { ok: true, summary: `fait ${modelId}`, data: {} };
  };
  return {
    protocol: 'openai-chat',
    capabilities: ['chat.default', 'chat.reasoning', 'chat.ingestion', 'image.generate'],
    supports: vi.fn(() => true),
    testConnection: vi.fn(),
    discoverModels: vi.fn(),
    execute: vi.fn(async (_config: ProviderConfig, request: { modelId: string }) => done(request.modelId)),
    chat: vi.fn(async (_config: ProviderConfig, input: { modelId: string }) => {
      await run(input.modelId);
      return { content: `dit ${input.modelId}`, reasoningContent: null, toolCalls: [] };
    }),
  } as unknown as AbstractProviderAdapter & { chat: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn>; supports: ReturnType<typeof vi.fn> };
}

function harness(routes: ResolvedRoute[]) {
  const store = { routes: vi.fn(async () => routes) };
  const registry = { resolve: vi.fn() };
  const audit = { record: vi.fn() };
  const legacy = { ensureMigrated: vi.fn(async () => undefined), reconcileInstance: vi.fn(async () => ({ checked: 2, updated: 1 })) };
  // Santé des fournisseurs : ce que le routeur en retient est lisible dans `health.record`.
  const health = { record: vi.fn() };
  const router = new CapabilityRouterService(store as never, registry as never, audit as never, legacy as never, health as never);
  return { router, store, registry, audit, legacy, health };
}

describe('CapabilityRouterService · résolution', () => {
  it('une capacité sans route rend null ; chaque résolution s\u0027assure auprès de la migration (qui ne migre qu\u0027une fois)', async () => {
    const { router, legacy } = harness([]);
    expect(await router.resolve(GUILD, 'chat.default')).toBeNull();
    await router.resolve(GUILD, 'chat.default');
    expect(legacy.ensureMigrated).toHaveBeenCalledTimes(2);
  });

  it('la route d\u0027un fournisseur désactivé n\u0027est pas active', async () => {
    const { router } = harness([route('chat.default', provider('off', { enabled: false }))]);
    expect(await router.resolve(GUILD, 'chat.default')).toBeNull();
  });

  it('conversation : l\u0027ingestion a sa route, puis le raisonnement quand la requête le réclame, sinon le défaut', async () => {
    const ingestion = route('chat.ingestion', provider('small'), null, 'cheap-model');
    const reasoning = route('chat.reasoning', provider('strong'), null, 'big-model');
    const byDefault = route('chat.default', provider('fast'), null, 'chat-model');
    const { router } = harness([ingestion, reasoning, byDefault]);
    expect((await router.chatEndpoint(GUILD, 'memory.ingestion', true))?.modelId).toBe('cheap-model');
    expect((await router.chatEndpoint(GUILD, 'reply', true))?.modelId).toBe('big-model');
    expect((await router.chatEndpoint(GUILD, 'reply', false))?.modelId).toBe('chat-model');
    expect(await router.chatEndpoint(null, 'reply', false)).toBeNull();
  });

  it('l\u0027alignement des copies d\u0027instance est délégué à la migration', async () => {
    const { router, legacy } = harness([]);
    expect(await router.reconcileInstance()).toEqual({ checked: 2, updated: 1 });
    expect(legacy.reconcileInstance).toHaveBeenCalledTimes(1);
  });
});

describe('CapabilityRouterService · repli automatique', () => {
  it('un 429 du fournisseur principal fait servir la capacité par le repli, et le repli est tracé', async () => {
    const primary = fakeAdapter(async () => {
      throw new ProviderError('HTTP 429', 'rate-limit', 429);
    });
    const backup = fakeAdapter(async () => undefined);
    const { router, registry, audit } = harness([route('image.generate', provider('primary'), provider('backup'))]);
    registry.resolve.mockReturnValueOnce(primary).mockReturnValueOnce(backup);

    const result = await router.runCapability(GUILD, 'image.generate', { params: { prompt: 'un chat' } }, ACTOR);

    expect(result).toEqual({ ok: true, summary: 'fait model-b', data: {} });
    expect(primary.execute).toHaveBeenCalledTimes(1);
    expect(backup.execute).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'capability.fallback', actorId: ACTOR, metadata: expect.objectContaining({ capability: 'image.generate', from: 'primary', to: 'backup' }) }),
    );
  });

  it('une 5xx laisse le repli prendre le relais, qui peut échouer à son tour', async () => {
    const primary = fakeAdapter(async () => {
      throw new ProviderError('HTTP 503', 'unavailable', 503);
    });
    const backup = fakeAdapter(async () => {
      throw new ProviderError('trop lent', 'timeout');
    });
    const { router, registry, audit } = harness([route('chat.default', provider('primary'), provider('backup'))]);
    registry.resolve.mockReturnValueOnce(primary).mockReturnValueOnce(backup);
    await expect(router.chat(GUILD, 'chat.default', turn())).rejects.toThrow('trop lent');
    expect(backup.chat).toHaveBeenCalledTimes(1);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ['une clé refusée', new ProviderError('HTTP 401', 'auth', 401)],
    ['un crédit épuisé', new ProviderError('HTTP 402', 'quota', 402)],
    ['une requête invalide', new ProviderError('HTTP 400', 'http', 400)],
  ])('%s ne bascule pas : le repli n\u0027est pas appelé', async (_label, error) => {
    const primary = fakeAdapter(async () => {
      throw error;
    });
    const backup = fakeAdapter(async () => undefined);
    const { router, registry } = harness([route('chat.default', provider('primary'), provider('backup'))]);
    registry.resolve.mockReturnValue(primary);
    await expect(router.chat(GUILD, 'chat.default', turn())).rejects.toBe(error);
    expect(backup.chat).not.toHaveBeenCalled();
  });

  it('sans fournisseur capable de servir la capacité, l\u0027exécution est refusée avec un message actionnable', async () => {
    const { router, registry } = harness([]);
    registry.resolve.mockReturnValue(fakeAdapter(async () => undefined));
    await expect(router.chat(GUILD, 'music.generate', turn())).rejects.toThrow('music.generate');

    const mute = fakeAdapter(async () => undefined);
    mute.supports.mockReturnValue(false);
    registry.resolve.mockReturnValue(mute);
    await expect(router.chatRoute(route('music.generate', provider('claude'), provider('other')), turn())).rejects.toThrow('Aucun fournisseur de la route ne sert « music.generate »');
    expect(mute.chat).not.toHaveBeenCalled();
  });
});

describe('CapabilityRouterService · tentatives d\u0027une route', () => {
  const primary = fakeAdapter(async () => undefined);

  it('le repli désactivé n\u0027est pas une tentative', () => {
    const { router, registry } = harness([]);
    registry.resolve.mockReturnValue(primary);
    const active = route('chat.default', provider('primary'), provider('off', { enabled: false }));
    expect(router.attemptsOf(active)).toHaveLength(1);
  });

  it('un fournisseur dont le protocole ne sert pas la capacité n\u0027est pas une tentative', () => {
    const incapable = fakeAdapter(async () => undefined);
    incapable.supports.mockReturnValue(false);
    const { router, registry } = harness([]);
    registry.resolve.mockReturnValueOnce(primary).mockReturnValueOnce(incapable);
    expect(router.attemptsOf(route('chat.default', provider('primary'), provider('backup')))).toHaveLength(1);
  });

  it('la tentative porte le fournisseur, son modèle et l\u0027adaptateur de son protocole', () => {
    const backup = fakeAdapter(async () => undefined);
    const { router, registry } = harness([]);
    registry.resolve.mockReturnValueOnce(primary).mockReturnValueOnce(backup);
    const attempts = router.attemptsOf(route('chat.default', provider('primary'), provider('backup')));
    expect(attempts.map((attempt) => [attempt.provider.slug, attempt.modelId, attempt.adapter])).toEqual([
      ['primary', 'model-a', primary],
      ['backup', 'model-b', backup],
    ]);
    expect(attempts[0]?.provider).toMatchObject({ slug: 'primary' });
  });
});

describe('CapabilityRouterService · clé d\u0027une capacité', () => {
  const instanceValue = { apiKey: `${KEY}-instance`, baseUrl: 'https://instance.example.com', modelId: 'V5' };

  it('vient de la route du serveur quand elle existe, avec son modèle', async () => {
    const { router } = harness([route('music.generate', provider('kie-main'), null, 'V6_MINI')]);
    const instance = vi.fn(async () => instanceValue);
    expect(await router.credentialsFor(GUILD, 'music.generate', instance)).toEqual({ apiKey: `${KEY}-kie-main`, baseUrl: 'https://kie-main.example.com/v1', modelId: 'V6_MINI' });
    expect(instance).not.toHaveBeenCalled();
  });

  it('sinon de l\u0027instance : capacité non routée, ou demande hors serveur', async () => {
    const { router } = harness([route('music.generate', provider('kie-main'))]);
    const instance = vi.fn(async () => instanceValue);
    expect(await router.credentialsFor(GUILD, 'tts.speak', instance)).toEqual(instanceValue);
    expect(await router.credentialsFor(null, 'music.generate', instance)).toEqual(instanceValue);
    expect(instance).toHaveBeenCalledTimes(2);
  });

  it('une route sans clé retombe sur l\u0027instance', async () => {
    const { router } = harness([route('image.generate', provider('noauth', { apiKey: null, authType: 'none' }))]);
    const instance = vi.fn(async () => null);
    expect(await router.credentialsFor(GUILD, 'image.generate', instance)).toBeNull();
    expect(instance).toHaveBeenCalledTimes(1);
  });
});
