import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { capabilityLabel, kindBadges, protocolLabel, servingModels } from '@/pages/guild/providers/labels';
import { firstServing, orderCapabilities } from '@/pages/guild/providers/route-matrix';
import { capabilityRoutes, providerView } from '@/test/fixtures';

/* Les libellés : le `t` rend la clé, pour lire quel libellé est choisi. */

const t = ((key: string) => key) as unknown as TFunction;

describe('libellés', () => {
  it('traduit un protocole connu, et rend tel quel un protocole inconnu', () => {
    expect(protocolLabel(t, 'kie-unified')).toBe('providers.protocol.kieUnified');
    expect(protocolLabel(t, 'proto-inconnu')).toBe('proto-inconnu');
  });

  it('traduit une capacité native, et rend son identifiant à une capacité custom', () => {
    expect(capabilityLabel(t, 'chat.default')).toBe('providers.capability.chatDefault');
    expect(capabilityLabel(t, 'custom.traduction')).toBe('custom.traduction');
  });
});

describe('kindBadges', () => {
  it('mappe les types du catalogue sur les badges du cahier des charges', () => {
    expect(kindBadges({ id: 'deepseek-chat', kinds: ['chat'] })).toEqual(['chat']);
    expect(kindBadges({ id: 'kling-v2', kinds: ['video'] })).toEqual(['video']);
    expect(kindBadges({ id: 'suno-v4', kinds: ['music'] })).toEqual(['audio']);
    expect(kindBadges({ id: 'tts-1', kinds: ['tts'] })).toEqual(['audio']);
    expect(kindBadges({ id: 'x', kinds: [] })).toEqual([]);
  });

  it('ajoute « Raisonnement » à un modèle de conversation fait pour cela, jamais aux autres', () => {
    expect(kindBadges({ id: 'deepseek-reasoner', kinds: ['chat'] })).toEqual(['chat', 'reasoning']);
    expect(kindBadges({ id: 'qwq-32b', kinds: ['chat'] })).toEqual(['chat', 'reasoning']);
    expect(kindBadges({ id: 'kling-reason', kinds: ['video'] })).toEqual(['video']);
  });

  it('trie les badges dans l’ordre d’affichage', () => {
    expect(kindBadges({ id: 'x', kinds: ['search', 'image'] })).toEqual(['image', 'web']);
  });
});

describe('servingModels', () => {
  const provider = providerView({
    models: [
      { id: 'chat-1', name: null, kinds: ['chat'], contextWindow: null, maxOutput: null, origin: 'discovered' },
      { id: 'image-1', name: null, kinds: ['image'], contextWindow: null, maxOutput: null, origin: 'discovered' },
      { id: 'search-1', name: null, kinds: ['search'], contextWindow: null, maxOutput: null, origin: 'discovered' },
    ],
  });

  it('ne retient que les modèles qui servent la capacité', () => {
    expect(servingModels(provider.models, 'image.generate').map((model) => model.id)).toEqual(['image-1']);
    expect(servingModels(provider.models, 'chat.default').map((model) => model.id)).toEqual(['chat-1']);
  });

  it('la recherche web est une capacité native : seuls les modèles de recherche la servent', () => {
    expect(servingModels(provider.models, 'web.search').map((model) => model.id)).toEqual(['search-1']);
  });

  it('rend tout pour une capacité custom, la route décide', () => {
    expect(servingModels(provider.models, 'custom.traduction')).toHaveLength(3);
  });
});

describe('matrice de routage', () => {
  it('range les capacités natives dans l’ordre du contrat, puis les capacités custom', () => {
    const routes = [...capabilityRoutes(), { capability: 'custom.a', main: null, fallback: null, params: {}, followsDefault: false }];
    const reversed = [...routes].reverse();
    expect(orderCapabilities(reversed).map((route) => route.capability)).toEqual([
      'chat.default',
      'chat.reasoning',
      'chat.ingestion',
      'image.generate',
      'image.edit',
      'music.generate',
      'tts.speak',
      'video.generate',
      'web.search',
      'custom.a',
    ]);
  });

  it('choisit le premier modèle qui sert la capacité, sinon le premier du fournisseur', () => {
    const provider = providerView();
    expect(firstServing(provider, 'chat.default')).toBe('deepseek-chat');
    expect(firstServing(provider, 'video.generate')).toBe('deepseek-chat');
    expect(firstServing(undefined, 'chat.default')).toBeNull();
  });
});
