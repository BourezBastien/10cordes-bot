import { describe, expect, it, vi } from 'vitest';
import { ChatEndpointPlanner, NOT_CONFIGURED_MESSAGE, type LegacyChatConfig } from './llm-endpoint';
import type { ResolvedRoute } from '../providers/provider-store.service';
import type { ProviderConfig } from '../providers/provider.types';

/**
 * Où envoyer un tour de conversation : la route de la capacité du serveur
 * (fournisseur, modèle, authentification), sinon la configuration d'instance.
 * Aucun appel réseau ici : la clé ne sert qu'à construire les en-têtes.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    guildId: GUILD,
    slug: 'example',
    displayName: 'Example',
    protocol: 'openai-chat',
    baseUrl: 'https://api.example.test/v1',
    authType: 'bearer',
    authHeaderName: null,
    apiKey: `${KEY}-route`,
    customHeaders: {},
    extraConfig: {},
    models: [],
    enabled: true,
    ...overrides,
  };
}

function route(provider: ProviderConfig, modelId = 'model-a'): ResolvedRoute {
  return { capability: 'chat.default', provider, modelId, fallback: null, params: {} };
}

const empty: LegacyChatConfig = { baseUrl: null, apiKey: undefined, model: '' };

function planner(chatEndpoint: (guildId: string | null, cause: string, preferReasoning: boolean) => Promise<ResolvedRoute | null>, legacy: LegacyChatConfig = empty) {
  const router = { chatEndpoint: vi.fn(chatEndpoint) };
  return { planner: new ChatEndpointPlanner({ router, legacy: () => legacy }), router };
}

describe('ChatEndpointPlanner · route du serveur', () => {
  it('envoie au fournisseur et au modèle de la route, avec son authentification', async () => {
    const { planner: subject, router } = planner(async () => route(config(), 'deepseek-flash'));
    const endpoint = await subject.plan({ userId: 'u', guildId: GUILD, cause: 'reply' }, false);
    expect(endpoint).toEqual({
      host: 'api.example.test',
      protocol: 'openai-chat',
      model: 'deepseek-flash',
      url: 'https://api.example.test/v1/chat/completions',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}-route` },
      route: expect.objectContaining({ modelId: 'deepseek-flash' }),
      attempt: null,
    });
    expect(router.chatEndpoint).toHaveBeenCalledWith(GUILD, 'reply', false);
  });

  it('kie.ai parle à la racine de son hôte : le chemin porte la version', async () => {
    const { planner: subject } = planner(async () => route(config({ protocol: 'kie-unified', baseUrl: 'https://api.kie.ai' })));
    expect((await subject.plan({ userId: 'u', guildId: GUILD, cause: 'reply' }, false)).url).toBe('https://api.kie.ai/v1/chat/completions');
  });

  it('authentification par en-tête dédié, en-têtes du fournisseur compris', async () => {
    const provider = config({ authType: 'header', authHeaderName: 'X-Goog-Key', customHeaders: { 'X-Title': '10cordes' } });
    const { planner: subject } = planner(async () => route(provider));
    expect((await subject.plan({ userId: 'u', guildId: GUILD, cause: 'reply' }, false)).headers).toEqual({
      'Content-Type': 'application/json',
      'X-Title': '10cordes',
      'X-Goog-Key': `${KEY}-route`,
    });
  });

  it('authentification par paramètre : la clé est dans l\u0027URL, jamais dans les en-têtes', async () => {
    const provider = config({ authType: 'query', authHeaderName: 'key', baseUrl: 'https://api.example.test/v1' });
    const { planner: subject } = planner(async () => route(provider));
    const endpoint = await subject.plan({ userId: 'u', guildId: GUILD, cause: 'reply' }, false);
    expect(endpoint.url).toBe(`https://api.example.test/v1/chat/completions?key=${KEY}-route`);
    expect(endpoint.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('une tentative porte son fournisseur et l\u0027adaptateur de son protocole', () => {
    const { planner: subject } = planner(async () => null);
    const adapter = { protocol: 'openai-chat' };
    const provider = config({ slug: 'backup' });
    const endpoint = subject.forProvider(provider, 'model-b', route(provider), adapter as never);
    expect(endpoint.attempt).toEqual({ provider: expect.objectContaining({ slug: 'backup' }), adapter });
    expect(endpoint.model).toBe('model-b');
    expect(subject.forProvider(provider, 'model-b', null).attempt).toBeNull();
  });
});

describe('ChatEndpointPlanner · configuration d\u0027instance', () => {
  it('sans route, le tour part à l\u0027URL et à la clé de l\u0027instance', async () => {
    const legacy: LegacyChatConfig = { baseUrl: 'https://instance.example.test/', apiKey: `${KEY}-instance`, model: 'instance-model' };
    const { planner: subject } = planner(async () => null, legacy);
    expect(await subject.plan({ userId: 'u', guildId: GUILD, cause: 'reply' }, false)).toEqual({
      host: 'instance.example.test',
      protocol: 'openai-chat',
      model: 'instance-model',
      url: 'https://instance.example.test/chat/completions',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}-instance` },
      route: null,
      attempt: null,
    });
  });

  it.each([
    ['aucune clé', { baseUrl: 'https://instance.example.test', apiKey: undefined, model: 'm' }],
    ['aucune URL', { baseUrl: null, apiKey: `${KEY}-instance`, model: 'm' }],
  ])('sans route ni %s : refus explicite, avant tout appel', async (_label, legacy) => {
    const { planner: subject } = planner(async () => null, legacy);
    await expect(subject.plan({ userId: 'u', guildId: GUILD, cause: 'reply' }, false)).rejects.toThrow(NOT_CONFIGURED_MESSAGE);
  });
});
