import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotTool } from '@10cordes/shared';
import { AppEnv } from '../../app.env';
import type { AbstractProviderAdapter } from '../providers/provider-adapter';
import type { IntegrationService } from '../integrations/integration.service';
import type { ResolvedRoute } from '../providers/provider-store.service';
import { ProviderError, type ProviderConfig } from '../providers/provider.types';
import { NOT_CONFIGURED_MESSAGE } from './llm-endpoint';
import { ProviderAuthError, isFallbackWorthy } from './llm.errors';
import { LlmService } from './llm.service';
import { detectRequestIntent } from './request-intent';

/**
 * Client LLM, orchestrateur du moteur multi-fournisseurs. Ce que fixent ces
 * tests : le tour part sur le modèle routé du serveur ; le fournisseur de
 * repli ne prend le relais que sur une erreur qui y invite et avant tout
 * texte publié ; l'effort et la capacité de conversation se décident UNE
 * fois par requête, contre le fournisseur qui l'exécutera.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';
const ACTOR = '1550000000000000002';

function provider(id: string, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id,
    guildId: GUILD,
    slug: id,
    displayName: id,
    protocol: 'openai-chat',
    baseUrl: `https://${id}.example.test/v1`,
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

function route(primary: ProviderConfig, fallback: ProviderConfig | null = null): ResolvedRoute {
  return { capability: 'chat.default', provider: primary, modelId: 'primary-model', fallback: fallback ? { provider: fallback, modelId: 'backup-model' } : null, params: {} };
}

function sse(text: string): Response {
  const encoder = new TextEncoder();
  const chunks = [`data: {"choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\n`, 'data: [DONE]\n\n'];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

/** Réponse de chaque hôte : le statut donné, sinon une réponse « Reçu. » (flux ou JSON selon la demande). */
function serveByHost(statuses: Record<string, number>, text = 'Reçu.'): ReturnType<typeof vi.fn<typeof fetch>> {
  const mock = vi.fn<typeof fetch>(async (input: string | Request | URL, init?: RequestInit) => {
    const host = new URL(String(input)).host;
    const status = Object.entries(statuses).find(([needle]) => host.includes(needle))?.[1];
    if (status) return new Response('{"error":"refusé"}', { status });
    const message = { content: text };
    if (bodyOf(init).stream) return sse(text);
    return new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function bridge(run: (turn: { onDelta?: (text: string) => void }) => Promise<void>) {
  return {
    chat: vi.fn(async (_config: ProviderConfig, input: { onDelta?: (text: string) => void }) => {
      await run(input);
      return { content: 'Réponse', reasoningContent: null, toolCalls: [] };
    }),
  } as unknown as AbstractProviderAdapter & { chat: ReturnType<typeof vi.fn> };
}

/** Essais d'une route : fournisseur principal, puis repli. */
function attemptsOf(target: ResolvedRoute | null, adapters: AbstractProviderAdapter[]) {
  return target
    ? [target.provider, ...(target.fallback ? [target.fallback.provider] : [])].map((candidate, index) => ({
        provider: candidate,
        modelId: index === 0 ? target.modelId : target.fallback?.modelId ?? '',
        adapter: adapters[index] ?? adapters[0] ?? ({} as AbstractProviderAdapter),
      }))
    : [];
}

/** Configuration d'instance telle qu'IntegrationService la résout (le harnais n'a pas de base). */
interface Instance {
  config: Record<string, string>;
  source?: 'db' | 'env' | 'none';
}

const INSTANCE: Instance = { config: { baseUrl: 'https://instance.example.test', apiKey: `${KEY}-instance`, model: 'instance-model' }, source: 'db' };

function harness(options: { route?: ResolvedRoute | null; reasoning?: ResolvedRoute; adapters?: AbstractProviderAdapter[]; env?: Record<string, string>; mode?: 'adaptive' | 'always' | 'off'; instance?: Instance } = {}) {
  const active = options.route ?? null;
  const adapters = options.adapters ?? [];
  // Comme CapabilityRouterService : la requête qui raisonne prend la route chat.reasoning du serveur, sinon chat.default.
  const router = {
    chatEndpoint: vi.fn(async (_guildId: string | null, _cause: string, preferReasoning: boolean) => (preferReasoning ? options.reasoning : null) ?? active),
    attemptsOf: vi.fn((target: ResolvedRoute | null = active) => attemptsOf(target, adapters)),
    noteFallback: vi.fn(),
    reconcileInstance: vi.fn(async () => ({ checked: 0, updated: 0 })),
  };
  const env = { LLM_API_KEY: undefined, LLM_API_URL: undefined, LLM_MODEL: undefined, LLM_EFFORT: 'high', ...options.env } as unknown as AppEnv;
  const integrations = {
    get: vi.fn(async () => ({ id: 'llm', config: {}, source: 'none', ...options.instance })),
    upsert: vi.fn(async (_id: string, _fields: Record<string, string>, _actorId: string): Promise<void> => undefined),
  };
  const registry = { register: vi.fn() };
  const settings = { get: vi.fn(async () => ({ thinkingMode: options.mode ?? 'adaptive' })) };
  // Santé des fournisseurs : ce que le service en retient est lisible dans `health.record`.
  const health = { record: vi.fn() };
  const service = new LlmService(env, registry as never, {} as never, {} as never, integrations as unknown as IntegrationService, router as never, settings as never, health as never);
  return { service, router, integrations, registry, settings, health };
}

const chatOptions = (overrides: Record<string, unknown> = {}) => ({ userId: ACTOR, guildId: GUILD, cause: 'reply' as const, reasoningEffort: null, preferReasoning: false, ...overrides });
const messages = () => [{ role: 'user' as const, content: 'bonjour' }];
/** Phrases banales : elles ne doivent jamais partir sur la route de raisonnement. */
const BANAL_PHRASES = ['réponds exactement « sonnette-ok » et rien d\u0027autre', 'salut ça va', 'quelle heure est-il'];
const ROUTED_MUTATING: BotTool[] = ['deleteChannel', 'provider.upsert', 'capability.bind', 'records.create', 'rules.set'].map((id) => ({ name: id } as BotTool));
const DEEPSEEK = provider('api.deepseek.com', { baseUrl: 'https://api.deepseek.com' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LlmService · modèle et fournisseur du tour', () => {
  it('le tour part à l\u0027URL du fournisseur routé, avec sa clé et son modèle', async () => {
    const fetchMock = serveByHost({});
    const { service } = harness({ route: route(provider('routed')) });
    expect((await service.chat(messages(), [], chatOptions())).served).toEqual({ provider: 'routed', model: 'primary-model', fallback: false, capability: 'chat.default' });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://routed.example.test/v1/chat/completions');
    expect(bodyOf(init)).toMatchObject({ model: 'primary-model' });
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}-routed` });
  });

  it('sans route : configuration d\u0027instance, ou refus explicite si elle n\u0027existe pas', async () => {
    serveByHost({});
    const instance = harness({ instance: INSTANCE });
    await instance.service.onBoot();
    const fetchMock = vi.mocked(fetch);
    await instance.service.chat(messages(), [], chatOptions());
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://instance.example.test/chat/completions');
    expect(bodyOf(fetchMock.mock.calls[0]?.[1])).toMatchObject({ model: 'instance-model' });

    fetchMock.mockClear();
    const bare = harness();
    await bare.service.onBoot();
    await expect(bare.service.chat(messages(), [], chatOptions())).rejects.toThrow(NOT_CONFIGURED_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('une route qu\u0027aucun protocole ne peut servir est refusée avant tout appel', async () => {
    const fetchMock = serveByHost({});
    const { service, router } = harness({ route: route(provider('routed')) });
    router.attemptsOf.mockReturnValue([]);
    await expect(service.chat(messages(), [], chatOptions())).rejects.toThrow('ne sert pas la conversation');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('LlmService · repli sur le fournisseur de secours', () => {
  it('un 429 du principal fait publier la réponse du repli, et le repli est tracé', async () => {
    const fetchMock = serveByHost({ 'primary.example.test': 429 });
    const active = route(provider('primary'), provider('backup'));
    const { service, router } = harness({ route: active });
    const onDelta = vi.fn();
    const result = await service.chatStream(messages(), [], chatOptions(), { onDelta });
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).host)).toEqual(['primary.example.test', 'backup.example.test']);
    expect(bodyOf(fetchMock.mock.calls[1]?.[1])).toMatchObject({ model: 'backup-model' });
    expect(onDelta).toHaveBeenCalledWith('Reçu.');
    expect(result.content).toBe('Reçu.');
    // Traçabilité : le tour dit qui l'a réellement exécuté (le journal d'usage llm.jsonl la rapporte).
    expect(result.served).toEqual({ provider: 'backup', model: 'backup-model', fallback: true, capability: 'chat.default' });
    expect(router.noteFallback).toHaveBeenCalledTimes(1);
    expect(router.noteFallback).toHaveBeenCalledWith(active, expect.objectContaining({ slug: 'backup' }), ACTOR);
  });

  it('un fournisseur principal injoignable cède la place au repli', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input: string | Request | URL) => {
      if (String(input).includes('primary.example.test')) throw Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNREFUSED') });
      return sse('Reçu.');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { service, router } = harness({ route: route(provider('primary'), provider('backup')) });
    const onDelta = vi.fn();
    expect((await service.chatStream(messages(), [], chatOptions(), { onDelta })).content).toBe('Reçu.');
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).host)).toEqual(['primary.example.test', 'backup.example.test']);
    expect(router.noteFallback).toHaveBeenCalledTimes(1);
  });

  it('une clé refusée ne bascule pas', async () => {
    const fetchMock = serveByHost({ 'primary.example.test': 401 });
    const { service, router } = harness({ route: route(provider('primary'), provider('backup')) });
    const failure = await service.chat(messages(), [], chatOptions()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderAuthError);
    expect(isFallbackWorthy(failure)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(router.noteFallback).not.toHaveBeenCalled();
  });

  it('pas de bascule une fois du texte publié : la réponse ne serait plus cohérente', async () => {
    const primary = bridge(async (turn) => {
      turn.onDelta?.('Réponse partielle ');
      throw new ProviderError('HTTP 429', 'rate-limit', 429);
    });
    const backup = bridge(async () => undefined);
    const { service, router } = harness({ route: route(provider('claude', { protocol: 'anthropic-messages' }), provider('other', { protocol: 'anthropic-messages' })), adapters: [primary, backup] });
    const onDelta = vi.fn();
    await expect(service.chatStream(messages(), [], chatOptions(), { onDelta })).rejects.toThrow('HTTP 429');
    expect(backup.chat).not.toHaveBeenCalled();
    expect(router.noteFallback).not.toHaveBeenCalled();
  });

  it('sans texte publié, un fournisseur à adaptateur limité cède la place au repli', async () => {
    const primary = bridge(async () => {
      throw new ProviderError('HTTP 503', 'unavailable', 503);
    });
    const backup = bridge(async () => undefined);
    const { service, router } = harness({ route: route(provider('claude', { protocol: 'anthropic-messages' }), provider('sonnet', { protocol: 'anthropic-messages' })), adapters: [primary, backup] });
    const onDelta = vi.fn();
    const result = await service.chatStream(messages(), [], chatOptions(), { onDelta });
    expect(result.content).toBe('Réponse');
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(backup.chat.mock.calls[0]?.[1]).toMatchObject({ modelId: 'backup-model' });
    expect(router.noteFallback).toHaveBeenCalledTimes(1);
  });
});

describe('LlmService · effort et capacité de conversation, décidés une fois', () => {
  it('l\u0027effort se décide contre le fournisseur qui exécutera : rien pour un endpoint qui refuse le champ', async () => {
    const { service, router } = harness({ route: route(provider('groq')), mode: 'always' });
    const plan = await service.planRequest({ userId: ACTOR, guildId: GUILD, cause: 'reply' }, false);
    expect(router.chatEndpoint).toHaveBeenCalledWith(GUILD, 'reply', true);
    expect(plan).toEqual({ preferReasoning: true, reasoningEffort: null });
  });

  it('contre un endpoint DeepSeek : l\u0027effort configuré quand la requête raisonne, `none` sinon', async () => {
    const { service } = harness({ route: route(provider('api.deepseek.com', { baseUrl: 'https://api.deepseek.com' })), mode: 'adaptive' });
    expect(await service.planRequest({ userId: ACTOR, guildId: GUILD, cause: 'reply' }, true)).toEqual({ preferReasoning: true, reasoningEffort: 'high' });
    expect(await service.planRequest({ userId: ACTOR, guildId: GUILD, cause: 'reply' }, false)).toEqual({ preferReasoning: false, reasoningEffort: 'none' });
  });

  it('le tour suit la capacité décidée pour la requête, sans redemander au réglage du serveur', async () => {
    serveByHost({});
    const { service, router } = harness({ route: route(provider('routed')), mode: 'always' });
    await service.chatStream(messages(), [], chatOptions({ preferReasoning: false }));
    expect(router.chatEndpoint).toHaveBeenCalledWith(GUILD, 'reply', false);
  });

  it('mode off : jamais de raisonnement, quel que soit le fournisseur', async () => {
    const { service } = harness({ route: route(provider('api.deepseek.com', { baseUrl: 'https://api.deepseek.com' })), mode: 'off' });
    expect(await service.planRequest({ userId: ACTOR, guildId: GUILD, cause: 'reply' }, true)).toEqual({ preferReasoning: false, reasoningEffort: 'none' });
  });

  it('une phrase banale part sur chat.default avec effort `none`, même des tools modifiants routés', async () => {
    const fetchMock = serveByHost({});
    const reasoning: ResolvedRoute = { ...route(DEEPSEEK), capability: 'chat.reasoning', modelId: 'reasoner-model' };
    const { service } = harness({ route: route(DEEPSEEK), reasoning });
    for (const phrase of BANAL_PHRASES) {
      const action = detectRequestIntent(phrase, ROUTED_MUTATING, []).action;
      const plan = await service.planRequest({ userId: ACTOR, guildId: GUILD, cause: 'reply' }, action);
      const result = await service.chat([{ role: 'user', content: phrase }], [], { ...chatOptions(), ...plan });
      expect(result.served).toMatchObject({ capability: 'chat.default', model: 'primary-model' });
      expect(bodyOf(fetchMock.mock.calls.at(-1)?.[1])).toMatchObject({ model: 'primary-model', reasoning_effort: 'none' });
    }
  });
});

describe('LlmService · configuration d\u0027instance et disponibilité', () => {
  it('au boot, la ligne d\u0027instance est lue déchiffrée auprès d\u0027IntegrationService, puis les copies sont alignées', async () => {
    const { service, integrations, router, registry } = harness();
    integrations.get.mockResolvedValue({ ...INSTANCE, config: { apiKey: `${KEY}-db`, baseUrl: 'https://instance.example.test', model: 'db-model' }, source: 'db' } as never);
    await service.onBoot();
    expect(service.configured).toBe(true);
    expect(service.status()).toMatchObject({ source: 'db', model: 'db-model' });
    expect(service.status().maskedKey).toContain('…');
    expect(service.status().maskedKey).not.toContain(KEY);
    expect(router.reconcileInstance).toHaveBeenCalledTimes(1);
    expect(integrations.upsert).not.toHaveBeenCalled();
    expect(registry.register).toHaveBeenCalled();
  });

  it('une ligne d\u0027instance illisible ne configure rien', async () => {
    const { service } = harness();
    await service.onBoot();
    expect(service.configured).toBe(false);
    expect(service.status().source).toBe('none');
  });

  it('la base a la priorité absolue : des variables LLM_* présentes ne ressuscitent pas une instance sans ligne lisible', async () => {
    serveByHost({});
    const { service } = harness({ env: { LLM_API_URL: 'https://env.example.test', LLM_API_KEY: `${KEY}-env`, LLM_MODEL: 'env-model' } });
    await service.onBoot();
    expect(service.configured).toBe(false);
    await expect(service.chat(messages(), [], chatOptions())).rejects.toThrow(NOT_CONFIGURED_MESSAGE);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('une base encore vide : l\u0027environnement sert, et le statut le dit', async () => {
    const { service } = harness({ instance: { ...INSTANCE, source: 'env' } });
    await service.onBoot();
    expect(service.configured).toBe(true);
    expect(service.status()).toMatchObject({ source: 'env', model: 'instance-model' });
  });

  it('la modale enregistre la ligne d\u0027instance : la source devient la base, et les copies suivent', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"data":[{"id":"deepseek-flash"}]}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { service, integrations, router } = harness();
    await service.applyConfig('custom', 'https://api.deepseek.com', `${KEY}-modal`, 'deepseek-flash');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.deepseek.com/models');
    expect(integrations.upsert).toHaveBeenCalledWith('llm', { baseUrl: 'https://api.deepseek.com', apiKey: `${KEY}-modal`, model: 'deepseek-flash' }, 'modal');
    expect(service.status()).toMatchObject({ source: 'db', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' });
    expect(router.reconcileInstance).toHaveBeenCalledTimes(1);
  });

  it('un serveur sans instance est servable dès qu\u0027il a une route de conversation', async () => {
    expect(await harness().service.isConfiguredFor(GUILD)).toBe(false);
    expect(await harness().service.isConfiguredFor(null)).toBe(false);
    expect(await harness({ route: route(provider('routed')) }).service.isConfiguredFor(GUILD)).toBe(true);
    const withInstance = harness({ instance: INSTANCE });
    await withInstance.service.onBoot();
    expect(await withInstance.service.isConfiguredFor(null)).toBe(true);
  });
});
