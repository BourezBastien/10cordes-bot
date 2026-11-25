import { describe, expect, it } from 'vitest';
import { CapabilityRouteViewSchema, NATIVE_CAPABILITIES, ProviderModelSchema, ProviderViewSchema } from '@10cordes/shared';
import type { ProviderStatus } from '@10cordes/shared';
import { INSTANCE_SOURCES } from './instance-defaults';
import { capabilityRouteViewsOf, keyStatusOf, providerModelViewOf, providerViewOf } from './provider-view.presenter';
import type { ResolvedRoute } from './provider-store.service';
import type { ProviderConfig } from './provider.types';

/**
 * Vues du contrat du panel. Ce que fixent ces tests : une vue ne montre
 * jamais la clé (elle dit qu'elle existe et en donne l'indice), ne montre que
 * le nom des en-têtes libres, respecte toujours les bornes du contrat, et
 * dit quelle route de conversation suit encore la conversation par défaut.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';
const NAME = 'name';

const UNKNOWN: ProviderStatus = { state: 'unknown', cooldownUntil: null, lastError: null, lastHttpStatus: null, lastCheckedAt: null };

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    guildId: GUILD,
    slug: 'openrouter',
    displayName: 'OpenRouter',
    protocol: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
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

describe('providerViewOf · jamais la clé', () => {
  it('dit que la clé existe et en donne l\u0027indice : quatre points, puis ses quatre derniers caractères', () => {
    const view = providerViewOf(config(), UNKNOWN);
    expect(view.key).toEqual({ hasApiKey: true, keyHint: '\u2022\u2022\u2022\u2022real' });
    expect(JSON.stringify(view)).not.toContain(KEY);
  });

  it('sans clé : absente, sans indice', () => {
    expect(providerViewOf(config({ apiKey: null }), UNKNOWN).key).toEqual({ hasApiKey: false, keyHint: null });
    expect(keyStatusOf('')).toEqual({ hasApiKey: false, keyHint: null });
  });

  it('une clé trop courte pour rester cachée ne montre rien d\u0027elle', () => {
    for (const short of ['a', 'abcd', 'abcdefg']) {
      expect(keyStatusOf(short)).toEqual({ hasApiKey: true, keyHint: '\u2022\u2022\u2022\u2022' });
      expect(keyStatusOf(short).keyHint).not.toContain(short);
    }
  });

  it('une erreur retenue qui recopie la clé ressort masquée', () => {
    const status: ProviderStatus = { state: 'error', cooldownUntil: null, lastError: `Clé refusée : ${KEY}`, lastHttpStatus: 401, lastCheckedAt: null };
    const view = providerViewOf(config(), status);
    expect(view.status.lastError).toBe('Clé refusée : [clé masquée]');
    expect(JSON.stringify(view)).not.toContain(KEY);
  });
});

describe('providerViewOf · ce que la carte montre', () => {
  it('hôte de l\u0027URL de base sans le chemin ni le port, origine du fournisseur, en-têtes libres par leur seul nom', () => {
    const view = providerViewOf(
      config({
        baseUrl: 'https://openrouter.ai:8443/api/v1?version=2',
        customHeaders: { 'HTTP-Referer': 'https://mon-serveur.example', 'X-Title': 'une valeur jamais montrée' },
        extraConfig: { _source: INSTANCE_SOURCES.llm, temperature: 0.3 },
      }),
      UNKNOWN,
    );
    expect(view).toMatchObject({ domain: 'openrouter.ai', source: 'instance', customHeaderNames: ['HTTP-Referer', 'X-Title'] });
    expect(JSON.stringify(view)).not.toContain('une valeur jamais montrée');
    expect(JSON.stringify(view)).not.toContain('temperature');
    expect(providerViewOf(config(), UNKNOWN).source).toBe('guild');
  });

  it('une URL illisible rend une chaîne bornée au lieu de lever', () => {
    expect(providerViewOf(config({ baseUrl: 'x'.repeat(400) }), UNKNOWN).domain).toHaveLength(253);
  });

  it('reste dans les bornes du contrat, quand bien même la ligne les dépasse', () => {
    const view = providerViewOf(
      config({
        displayName: 'n'.repeat(100),
        authHeaderName: 'h'.repeat(90),
        authType: 'header',
        customHeaders: { ['x'.repeat(80)]: 'v' },
        models: [
          { id: 'm'.repeat(200), [NAME]: 't'.repeat(200), kinds: Array.from({ length: 12 }, () => 'chat' as const), contextWindow: 0, maxOutput: -5 },
          { id: 'old', origin: 'manual' },
        ],
      }),
      { state: 'error', cooldownUntil: null, lastError: 'e'.repeat(400), lastHttpStatus: 500, lastCheckedAt: new Date(0).toISOString() },
    );
    const parsed = ProviderViewSchema.safeParse(view);
    expect(parsed.success).toBe(true);
    expect(view.displayName).toHaveLength(80);
    expect(view.authHeaderName).toHaveLength(60);
    expect(view.customHeaderNames[0]).toHaveLength(60);
    expect(view.models[0]).toEqual({ id: 'm'.repeat(120), [NAME]: 't'.repeat(120), kinds: Array.from({ length: 8 }, () => 'chat'), contextWindow: null, maxOutput: null, origin: 'discovered' });
    expect(view.status.lastError).toHaveLength(300);
  });
});

describe('providerModelViewOf', () => {
  it('sans marque, un modèle est découvert ; ses familles se lisent de `kinds`, sinon de `kind`', () => {
    expect(providerModelViewOf({ id: 'a', kind: 'music' })).toEqual({ id: 'a', [NAME]: null, kinds: ['music'], contextWindow: null, maxOutput: null, origin: 'discovered' });
    expect(providerModelViewOf({ id: 'b', [NAME]: 'B', kinds: ['chat', 'image'], contextWindow: 128000, maxOutput: 4096 })).toMatchObject({ kinds: ['chat', 'image'], contextWindow: 128000, maxOutput: 4096 });
    expect(ProviderModelSchema.safeParse(providerModelViewOf({ id: 'b', kinds: ['chat', 'image'] })).success).toBe(true);
  });

  it('un slug saisi à la main garde sa marque et ne déclare aucune famille', () => {
    expect(providerModelViewOf({ id: 'ma-voix', origin: 'manual' })).toMatchObject({ origin: 'manual', kinds: [] });
  });
});

function route(capability: string, providerId: string, modelId: string, fallback: [string, string] | null = null, params: Record<string, unknown> = {}): ResolvedRoute {
  const of = (id: string): ProviderConfig => config({ id, slug: `slug-${id}`, apiKey: null });
  return {
    capability: capability as ResolvedRoute['capability'],
    provider: of(providerId),
    modelId,
    fallback: fallback ? { provider: of(fallback[0]), modelId: fallback[1] } : null,
    params,
  };
}

const slugOf = (providerId: string): string => `slug-${providerId}`;

describe('capabilityRouteViewsOf', () => {
  it('les capacités natives dans l\u0027ordre de la matrice de routage, non liées quand le serveur n\u0027a pas de route', () => {
    const routes = capabilityRouteViewsOf([], slugOf);
    expect(routes.map((entry) => entry.capability)).toEqual([...NATIVE_CAPABILITIES]);
    expect(routes[0]).toEqual({ capability: 'chat.default', main: null, fallback: null, params: {}, followsDefault: false });
    expect(CapabilityRouteViewSchema.array().safeParse(routes).success).toBe(true);
  });

  it('une route liée : fournisseur principal et repli, nommés par leur slug ; les capacités custom à la suite', () => {
    const routes = capabilityRouteViewsOf(
      [route('music.generate', 'kie', 'V6_MINI', ['other', 'V5'], { style: 'chill' }), route('custom.translate', 'misc', 'translator')],
      slugOf,
    );
    expect(routes.at(-1)).toEqual({ capability: 'custom.translate', main: { providerId: 'misc', providerSlug: 'slug-misc', modelId: 'translator' }, fallback: null, params: {}, followsDefault: false });
    expect(routes.find((entry) => entry.capability === 'music.generate')).toEqual({
      capability: 'music.generate',
      main: { providerId: 'kie', providerSlug: 'slug-kie', modelId: 'V6_MINI' },
      fallback: { providerId: 'other', providerSlug: 'slug-other', modelId: 'V5' },
      params: { style: 'chill' },
      followsDefault: false,
    });
  });

  it('le raisonnement et l\u0027ingestion suivent la conversation par défaut tant qu\u0027ils partagent exactement sa cible', () => {
    const same = route('chat.default', 'main', 'flash');
    const routes = capabilityRouteViewsOf([same, route('chat.reasoning', 'main', 'flash'), route('chat.ingestion', 'main', 'flash', ['backup', 'flash'])], slugOf);
    expect(routes.find((entry) => entry.capability === 'chat.reasoning')?.followsDefault).toBe(true);
    // Un repli, un autre modèle ou un autre fournisseur : la route est réglée séparément.
    expect(routes.find((entry) => entry.capability === 'chat.ingestion')?.followsDefault).toBe(false);
    expect(routes.find((entry) => entry.capability === 'chat.default')?.followsDefault).toBe(false);
    expect(capabilityRouteViewsOf([same, route('chat.reasoning', 'main', 'big')], slugOf).find((entry) => entry.capability === 'chat.reasoning')?.followsDefault).toBe(false);
    expect(capabilityRouteViewsOf([same, route('chat.reasoning', 'other', 'flash')], slugOf).find((entry) => entry.capability === 'chat.reasoning')?.followsDefault).toBe(false);
  });

  it('des paramètres différents séparent deux routes ; sans conversation par défaut, rien ne la suit', () => {
    expect(capabilityRouteViewsOf([route('chat.default', 'main', 'flash'), route('chat.reasoning', 'main', 'flash', null, { effort: 'high' })], slugOf)[1].followsDefault).toBe(false);
    expect(capabilityRouteViewsOf([route('chat.reasoning', 'main', 'flash')], slugOf)[1].followsDefault).toBe(false);
  });
});
