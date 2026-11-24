import { describe, expect, it } from 'vitest';
import { INSTANCE_SOURCES, instanceSourceOf, kieModelFor, recordedModel } from './instance-defaults';
import { planInstanceDefaults, slugFromHost } from './instance-defaults.plan';
import type { ResolvedRoute } from './provider-store.service';
import type { ProviderConfig } from './provider.types';

/**
 * Table des réglages par défaut de l'instance et son plan (fonctions pures).
 * L'application réelle (vrai store, base en mémoire) est couverte par
 * provider-legacy.migration.spec.ts ; ici, les cas qu'elle ne montre pas.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';
const GUILD = '1550000000000000001';

type Source = (typeof INSTANCE_SOURCES)[keyof typeof INSTANCE_SOURCES];

function copy(source: Source | null, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
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
    extraConfig: source ? { _source: source } : {},
    models: [],
    enabled: true,
    ...overrides,
  };
}

const bound = (capability: string, provider: ProviderConfig, modelId: string): ResolvedRoute => ({ capability: capability as ResolvedRoute['capability'], provider, modelId, fallback: null, params: {} });
const LLM = { apiKey: `${KEY}-llm`, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' };
const KIE = { apiKey: `${KEY}-kie` };

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

describe('table des réglages par défaut', () => {
  it('le modèle kie.ai d\u0027une capacité vient du catalogue de l\u0027adaptateur, jamais d\u0027une constante', () => {
    expect(kieModelFor('music.generate')).toBe('V6_MINI');
    expect(kieModelFor('image.generate')).toBe('z-image');
    expect(kieModelFor('image.edit')).toBe('z-image');
    // Famille absente du catalogue : la capacité reste à lier à la main.
    expect(kieModelFor('tts.speak')).toBeNull();
    expect(kieModelFor('video.generate')).toBeNull();
    // Un catalogue qui déclare la vidéo lie la vidéo.
    expect(kieModelFor('video.generate', [{ id: 'kling-2.5', kind: 'video' }])).toBe('kling-2.5');
  });

  it('une copie d\u0027instance se reconnaît à sa marque, pour chaque source ; un fournisseur d\u0027administrateur n\u0027en a pas', () => {
    for (const source of Object.values(INSTANCE_SOURCES)) {
      expect(instanceSourceOf({ extraConfig: { _source: source } })).toBe(source);
    }
    expect(instanceSourceOf({ extraConfig: { _source: 'instance:autre' } })).toBeNull();
    expect(instanceSourceOf({ extraConfig: { _source: 'llm' } })).toBeNull();
    expect(instanceSourceOf({ extraConfig: {} })).toBeNull();
    expect(instanceSourceOf({ extraConfig: { _source: 42 } })).toBeNull();
  });

  it('le modèle que la table avait donné à une capacité : par capacité, sinon le modèle unique', () => {
    const provider = { extraConfig: { _models: { 'chat.default': 'flash' }, _model: 'ancien' } };
    expect(recordedModel(provider, 'chat.default')).toBe('flash');
    expect(recordedModel(provider, 'chat.reasoning')).toBe('ancien');
    expect(recordedModel({ extraConfig: {} }, 'chat.default')).toBeNull();
  });
});

describe('planInstanceDefaults', () => {
  it('un fournisseur IA d\u0027instance sans modèle : le fournisseur est créé, aucune route de conversation', () => {
    const plan = planInstanceDefaults({ providers: [], routes: [], llm: { apiKey: `${KEY}-llm`, baseUrl: 'https://api.deepseek.com' }, kie: null });
    expect(plan.providers.map((step) => step.slug)).toEqual(['deepseek-official']);
    expect(plan.routes).toEqual([]);
  });

  it('le slug d\u0027instance vient de l\u0027hôte du fournisseur IA, et le nom le montre', () => {
    const plan = planInstanceDefaults({ providers: [], routes: [], llm: { apiKey: `${KEY}-llm`, baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' }, kie: null });
    expect(plan.providers[0]).toMatchObject({
      slug: 'openrouter',
      write: true,
      providerId: null,
      input: { slug: 'openrouter', displayName: 'IA (openrouter.ai)', protocol: 'openai-chat', baseUrl: 'https://openrouter.ai/api/v1', extraConfig: { _model: 'openai/gpt-4o-mini' } },
    });
  });

  it('sans instance du tout : rien à créer ni lier, mais une ancienne copie PixelLab est quand même retirée', () => {
    const legacy = copy(INSTANCE_SOURCES.pixellab, { id: 'pixel', slug: 'pixellab' });
    const plan = planInstanceDefaults({ providers: [legacy], routes: [bound('image.generate', legacy, 'create-image-pixflux')], llm: null, kie: null });
    expect(plan).toEqual({ providers: [], routes: [], removals: [{ providerId: 'pixel', slug: 'pixellab' }] });
  });

  it('une capacité restée sur la copie du fournisseur IA alors que la table la veut sur kie.ai suit la table', () => {
    const llmCopy = copy(INSTANCE_SOURCES.llm, { extraConfig: { _source: INSTANCE_SOURCES.llm, _model: 'deepseek-flash' } });
    const plan = planInstanceDefaults({ providers: [llmCopy], routes: [bound('music.generate', llmCopy, 'V6_MINI')], llm: LLM, kie: KIE });
    const music = plan.routes.find((route) => route.capability === 'music.generate');
    expect(music).toMatchObject({ source: INSTANCE_SOURCES.kie, modelId: 'V6_MINI', keepFallback: false });
    expect(plan.routes.map((route) => route.capability)).toEqual(['chat.default', 'chat.reasoning', 'chat.ingestion', 'image.generate', 'image.edit', 'music.generate']);
  });

  it('une copie existante sous un slug qu\u0027un autre fournisseur porte garde le sien', () => {
    const kieCopy = copy(INSTANCE_SOURCES.kie, { id: 'kie', slug: 'kie-main', protocol: 'kie-unified' });
    const own = copy(null, { id: 'own', slug: 'kie-ai', protocol: 'kie-unified', baseUrl: 'https://proxy.example.test' });
    const plan = planInstanceDefaults({ providers: [kieCopy, own], routes: [], llm: null, kie: KIE });
    const step = plan.providers[0];
    expect(step).toMatchObject({ providerId: 'kie', slug: 'kie-main', write: true, input: { slug: 'kie-main', enabled: true } });
  });

  it('une copie déjà conforme n\u0027est pas réécrite', () => {
    const conversation = { 'chat.default': 'deepseek-flash', 'chat.reasoning': 'deepseek-flash', 'chat.ingestion': 'deepseek-flash' };
    const llmCopy = copy(INSTANCE_SOURCES.llm, { apiKey: `${KEY}-llm`, extraConfig: { _source: INSTANCE_SOURCES.llm, _models: conversation, _model: 'deepseek-flash' } });
    const plan = planInstanceDefaults({
      providers: [llmCopy],
      routes: ['chat.default', 'chat.reasoning', 'chat.ingestion'].map((capability) => bound(capability, llmCopy, 'deepseek-flash')),
      llm: LLM,
      kie: null,
    });
    expect(plan).toEqual({ providers: [expect.objectContaining({ write: false, providerId: 'copy-1' })], routes: [], removals: [] });
  });
});
