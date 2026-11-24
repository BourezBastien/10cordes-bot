import { describe, expect, it, vi } from 'vitest';
import { ProviderError, type ProviderConfig } from '../provider.types';
import type { ResolvedRoute } from '../provider-store.service';
import { ProviderHubViewBuilder } from './provider-hub.view';

/** Vue du panneau, relue depuis le store (doublure : aucune base de données). */

const GUILD = '1550000000000000001';
const FIRST = 'cmProviderId0000000000000';
const SECRET = 'sk-test-secret';

function config(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: FIRST, guildId: GUILD, slug: 'openai', displayName: 'OpenAI', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer', authHeaderName: null, apiKey: SECRET, customHeaders: {}, extraConfig: {}, models: [{ id: 'gpt-4o', kind: 'chat' }], enabled: true, ...patch,
  };
}

function harness(configs: ProviderConfig[], routes: ResolvedRoute[] = []) {
  const store = { list: vi.fn(async (): Promise<ProviderConfig[]> => configs), routes: vi.fn(async (): Promise<ResolvedRoute[]> => routes) };
  return { store, registry: { resolve: vi.fn(() => ({ capabilities: ['chat.default', 'chat.reasoning'] })) } };
}

type Harness = ReturnType<typeof harness>;

const build = (h: Harness, state: Parameters<ProviderHubViewBuilder['build']>[1]): ReturnType<ProviderHubViewBuilder['build']> =>
  new ProviderHubViewBuilder(h.store as never, h.registry as never).build(GUILD, state);

describe('ProviderHubViewBuilder', () => {
  it('rend des vues publiques : fournisseurs dans l\u0027ordre du store, routes décrites avec leur repli, jamais la clé', async () => {
    const primary = config();
    const backup = config({ id: 'second', slug: 'deepseek', apiKey: null, enabled: false });
    const routes: ResolvedRoute[] = [
      { capability: 'chat.default', provider: primary, modelId: 'gpt-4o', fallback: { provider: backup, modelId: 'deepseek-chat' }, params: {} },
      { capability: 'music.generate', provider: backup, modelId: 'suno', fallback: null, params: {} },
    ];
    const view = await build(harness([primary, backup], routes), { p: 'second', c: 'music.generate', n: 2 });
    expect(view.providers.map((entry) => entry.slug)).toEqual(['openai', 'deepseek']);
    expect(view.providers[0]).toMatchObject({ hasKey: true, enabled: true, models: 1, capabilities: ['chat.default', 'chat.reasoning'] });
    expect(view.providers[1]).toMatchObject({ hasKey: false, enabled: false });
    expect(view.routes).toEqual([
      expect.objectContaining({ capability: 'chat.default', providerSlug: 'openai', modelId: 'gpt-4o', fallback: 'deepseek/deepseek-chat', label: 'Conversation (défaut)', kind: 'chat', enabled: true }),
      expect.objectContaining({ capability: 'music.generate', providerSlug: 'deepseek', modelId: 'suno', fallback: null, enabled: false }),
    ]);
    expect(view).toMatchObject({ selectedProviderId: 'second', selectedCapability: 'music.generate', page: 2 });
    expect(JSON.stringify(view)).not.toContain(SECRET);
  });

  it('un fournisseur disparu désélectionne, une capacité inconnue ramène à la première, sans état la page est 1', async () => {
    const h = harness([config()]);
    expect(await build(h, { p: 'parti', c: 'custom.nimportequoi' })).toMatchObject({ selectedProviderId: null, selectedCapability: 'chat.default' });
    expect(await build(h, {})).toMatchObject({ selectedProviderId: null, selectedCapability: 'chat.default', page: 1 });
  });

  it('un adaptateur absent n\u0027est pas fatal : le fournisseur paraît sans capacité native', async () => {
    const h = harness([config()]);
    h.registry.resolve.mockImplementation(() => {
      throw new ProviderError('Aucun adaptateur pour le protocole openai-chat.', 'unsupported');
    });
    expect((await build(h, {})).providers[0]?.capabilities).toEqual([]);
  });
});
