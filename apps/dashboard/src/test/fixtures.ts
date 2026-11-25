import type {
  CapabilityRouteView,
  GuildRules,
  IntegrationView,
  ProviderView,
  UsageSummary,
  WebhookEndpointView,
} from '@10cordes/shared';

/*
 * FIXTURES DES TESTS. Des objets conformes au contrat partagé, fabriqués par
 * des fonctions pour dériver les cas. Aucun secret réel : la clé qui sert à
 * prouver le masquage est une chaîne explicite.
 */

export const FAKE_SECRET = 'test-key-not-real-4242';

export function providerView(overrides: Partial<ProviderView> = {}): ProviderView {
  return {
    providerId: 'prov-deepseek',
    slug: 'deepseek-official',
    displayName: 'DeepSeek',
    protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    domain: 'api.deepseek.com',
    source: 'instance',
    enabled: true,
    authType: 'bearer',
    authHeaderName: null,
    key: { hasApiKey: true, keyHint: '••••4242' },
    customHeaderNames: [],
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        kinds: ['chat'],
        contextWindow: 128_000,
        maxOutput: 8192,
        origin: 'discovered',
      },
      { id: 'deepseek-reasoner', name: null, kinds: ['chat'], contextWindow: null, maxOutput: null, origin: 'manual' },
    ],
    status: { state: 'active', cooldownUntil: null, lastError: null, lastHttpStatus: 200, lastCheckedAt: '2026-11-25T08:00:00.000Z' },
    ...overrides,
  };
}

export const COOLING_PROVIDER = providerView({
  providerId: 'prov-kie',
  slug: 'kie-ai',
  displayName: 'kie.ai',
  protocol: 'kie-unified',
  baseUrl: 'https://api.kie.ai/api/v1',
  domain: 'api.kie.ai',
  source: 'guild',
  models: [{ id: 'kling-v2', name: null, kinds: ['video'], contextWindow: null, maxOutput: null, origin: 'manual' }],
  key: { hasApiKey: false, keyHint: null },
  status: { state: 'cooldown', cooldownUntil: new Date(Date.now() + 90_000).toISOString(), lastError: 'HTTP 429', lastHttpStatus: 429, lastCheckedAt: '2026-11-25T08:00:00.000Z' },
});

export const CAPABILITY_IDS = [
  'chat.default',
  'chat.reasoning',
  'chat.ingestion',
  'image.generate',
  'image.edit',
  'music.generate',
  'tts.speak',
  'video.generate',
  'web.search',
] as const;

export function capabilityRoutes(): CapabilityRouteView[] {
  const target = { providerId: 'prov-deepseek', providerSlug: 'deepseek-official', modelId: 'deepseek-chat' };
  return CAPABILITY_IDS.map((capability) => ({
    capability,
    main: capability.startsWith('chat.') ? target : null,
    fallback: null,
    params: {},
    followsDefault: capability === 'chat.reasoning' || capability === 'chat.ingestion',
  }));
}

export const integrationView: IntegrationView = {
  slug: 'pixellab',
  name: 'PixelLab',
  tools: ['image.icon', 'image.emoji', 'image.pixel'],
  source: 'instance',
  enabled: true,
  baseUrl: 'https://api.pixellab.ai/v1',
  key: { hasApiKey: true, keyHint: '••••7890' },
  model: null,
};

export const webhookView: WebhookEndpointView = {
  webhookId: 'hook-1',
  slug: 'n8n-alert',
  name: 'Alerte n8n',
  method: 'POST',
  url: 'https://hooks.exemple.com/v1/alert?source=10cordes',
  domain: 'hooks.exemple.com',
  authType: 'bearer',
  authHeaderName: 'Authorization',
  publicHeaders: { 'X-Org': 'test' },
  secretHeaderNames: ['Authorization'],
  requestTemplate: { text: '{{payload}}' },
  responseExtractPath: 'data.result',
  enabled: true,
  lastHttpStatus: 200,
  lastCheckedAt: '2026-11-25T07:30:00.000Z',
  lastError: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-24T10:00:00.000Z',
};

export const guildRules: GuildRules = {
  freeCategoryIds: [],
  freeChannelIds: ['1550835980116824101'],
  blockedChannelIds: [],
  strictMentionElsewhere: true,
  seriousOnlyElsewhere: false,
  confirmDestructiveActions: true,
  customInstructions: ['Réponds en français.'],
};

export const usageSummary: UsageSummary = {
  window: '24h',
  turns: 42,
  promptTokens: 120_000,
  completionTokens: 30_000,
  errors: 2,
  fallbacks: 1,
  byModel: [
    { provider: 'deepseek-official', model: 'deepseek-chat', turns: 40, promptTokens: 110_000, completionTokens: 28_000, errors: 2, fallbacks: 1 },
    { provider: null, model: 'inconnu', turns: 2, promptTokens: 10_000, completionTokens: 2_000, errors: 0, fallbacks: 0 },
  ],
  byDay: [
    { day: '2026-11-24', turns: 12, tokens: 50_000 },
    { day: '2026-11-25', turns: 30, tokens: 100_000 },
  ],
};
