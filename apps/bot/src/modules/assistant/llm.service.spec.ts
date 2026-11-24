import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppEnv } from '../../app.env';
import type { AbstractProviderAdapter } from '../providers/provider-adapter';
import type { IntegrationService } from '../integrations/integration.service';
import type { ResolvedRoute } from '../providers/provider-store.service';
import { ProviderError, type ProviderConfig } from '../providers/provider.types';
import { NOT_CONFIGURED_MESSAGE } from './llm-endpoint';
import { ProviderAuthError, isFallbackWorthy } from './llm.errors';
import { LlmService } from './llm.service';

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

function harness(options: { route?: ResolvedRoute | null; adapters?: AbstractProviderAdapter[]; env?: Record<string, string>; mode?: 'adaptive' | 'always' | 'off' } = {}) {
  const active = options.route ?? null;
  const adapters = options.adapters ?? [];
  const attempts = active
    ? [active.provider, ...(active.fallback ? [active.fallback.provider] : [])].map((candidate, index) => ({
        provider: candidate,
        modelId: index === 0 ? active.modelId : active.fallback?.modelId ?? '',
        adapter: adapters[index] ?? adapters[0] ?? ({} as AbstractProviderAdapter),
      }))
    : [];
  const router = {
    chatEndpoint: vi.fn(async () => active),
    attemptsOf: vi.fn(() => attempts),
    noteFallback: vi.fn(),
    reconcileInstance: vi.fn(async () => ({ checked: 0, updated: 0 })),
  };
  const env = { LLM_API_KEY: undefined, LLM_API_URL: undefined, LLM_MODEL: undefined, LLM_EFFORT: 'high', ...options.env } as unknown as AppEnv;
  const integrations = { get: vi.fn(async () => ({ id: 'llm', config: {}, source: 'none' })), upsert: vi.fn() };
  const registry = { register: vi.fn() };
  const settings = { get: vi.fn(async () => ({ thinkingMode: options.mode ?? 'adaptive' })) };
  const service = new LlmService(env, registry as never, {} as never, {} as never, integrations as unknown as IntegrationService, router as never, settings as never);
  return { service, router, integrations, registry, settings };
}

const chatOptions = (overrides: Record<string, unknown> = {}) => ({ userId: ACTOR, guildId: GUILD, cause: 'reply' as const, reasoningEffort: null, preferReasoning: false, ...overrides });
const messages = () => [{ role: 'user' as const, content: 'bonjour' }];

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
    const fetchMock = serveByHost({});
    const instance = harness({ env: { LLM_API_URL: 'https://instance.example.test', LLM_API_KEY: `${KEY}-instance`, LLM_MODEL: 'instance-model' } });
    await instance.service.chat(messages(), [], chatOptions());
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://instance.example.test/chat/completions');
    expect(bodyOf(fetchMock.mock.calls[0]?.[1]).model).toBe('instance-model');

    fetchMock.mockClear();
    const bare = harness();
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
});

describe('LlmService · configuration d\u0027instance et disponibilité', () => {
  it('au boot, la ligne d\u0027instance est lue déchiffrée auprès d\u0027IntegrationService, puis les copies sont alignées', async () => {
    const { service, integrations, router, registry } = harness();
    integrations.get.mockResolvedValue({ id: 'llm', config: { apiKey: `${KEY}-db`, baseUrl: 'https://instance.example.test', model: 'db-model' }, source: 'db' } as never);
    await service.onBoot();
    expect(service.configured).toBe(true);
    expect(service.status()).toMatchObject({ source: 'modal', model: 'db-model' });
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
  });

  it('un serveur sans instance est servable dès qu\u0027il a une route de conversation', async () => {
    expect(await harness().service.isConfiguredFor(GUILD)).toBe(false);
    expect(await harness().service.isConfiguredFor(null)).toBe(false);
    expect(await harness({ route: route(provider('routed')) }).service.isConfiguredFor(GUILD)).toBe(true);
    const withInstance = harness({ env: { LLM_API_URL: 'https://instance.example.test', LLM_API_KEY: `${KEY}-instance` } });
    expect(await withInstance.service.isConfiguredFor(null)).toBe(true);
  });
});
