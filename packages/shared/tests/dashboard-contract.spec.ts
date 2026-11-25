import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_KINDS,
  CapabilityBindSchema,
  CapabilityRouteViewSchema,
  CapabilitySchema,
  CapabilityUnbindSchema,
  ComponentLayoutSchema,
  KeyStatusSchema,
  NATIVE_CAPABILITIES,
  ProviderCreateSchema,
  ProviderUpdateSchema,
  ProviderViewSchema,
  SlugSchema,
  SnowflakeSchema,
  USAGE_WINDOW_HOURS,
  USAGE_WINDOWS,
  AssistantConfigSchema,
  GuildRulesPatchSchema,
  capabilityKind,
} from '../src/index.js';

/**
 * Le contrat du panel web et des schémas de configuration que personne ne
 * relisait : capacités et routes, création et mise à jour d'un fournisseur
 * (jamais la clé dans une vue), règles du serveur, layout de composants,
 * salon dédié de l'assistant.
 */

const CHANNEL_ID = '1550000000000000001';
const DISCARDED = 'discarded';
/** Valeur de test, jamais une clé réelle. */
const TEST_KEY = 'test-key-not-real';

const messagesOf = (parsed: { success: boolean; error?: { issues: Array<{ message: string }> } }): string[] =>
  parsed.success ? [] : (parsed.error?.issues ?? []).map((issue) => issue.message);

describe('CapabilitySchema', () => {
  it('les capacités natives du bot se lisent', () => {
    for (const capability of NATIVE_CAPABILITIES) expect(CapabilitySchema.safeParse(capability).success, capability).toBe(true);
  });

  it.each(['custom.translate', 'custom.image-upscale_v2', 'custom.ab'])('une capacité %s bien formée se lit', (capability) => {
    expect(CapabilitySchema.safeParse(capability).success).toBe(true);
  });

  it.each([
    ['une capacité inconnue', 'translate'],
    ['custom sans nom', 'custom.'],
    ['custom d\u0027un seul caractère', 'custom.a'],
    ['custom en majuscules', 'custom.Translate'],
    ['custom avec une espace', 'custom.two words'],
    ['custom trop longue', `custom.${'a'.repeat(49)}`],
  ])('%s est refusée, et le refus dit la forme attendue', (_label, capability) => {
    expect(CapabilitySchema.safeParse(capability).success).toBe(false);
    if (capability.length <= 56) expect(messagesOf(CapabilitySchema.safeParse(capability))).toEqual(['Capacité inconnue : native du bot, ou de la forme custom.nom.']);
  });

  it('le nom d\u0027une capacité custom accepte 48 caractères, le nom entier 56', () => {
    expect(CapabilitySchema.safeParse(`custom.${'a'.repeat(48)}`).success).toBe(true);
    expect(CapabilitySchema.safeParse(`custom.${'a'.repeat(50)}`).success).toBe(false);
    expect(messagesOf(CapabilitySchema.safeParse(`custom.${'a'.repeat(50)}`))).not.toEqual(['Capacité inconnue : native du bot, ou de la forme custom.nom.']);
  });
});

describe('capabilityKind', () => {
  it.each([
    ['chat.default', 'chat'],
    ['chat.reasoning', 'chat'],
    ['chat.ingestion', 'chat'],
    ['image.edit', 'image'],
    ['music.generate', 'music'],
    ['tts.speak', 'tts'],
    ['video.generate', 'video'],
    ['web.search', 'search'],
    ['custom.translate', 'custom'],
    ['translation.auto', 'custom'],
    ['', 'custom'],
  ])('%s est de la famille %s', (capability, kind) => {
    expect(capabilityKind(capability)).toBe(kind);
  });

  it('chaque capacité native a sa famille, et `web.search` est une recherche', () => {
    expect(CAPABILITY_KINDS).toEqual(['chat', 'image', 'music', 'tts', 'video', 'search', 'custom']);
    expect(NATIVE_CAPABILITIES.map(capabilityKind)).toEqual(['chat', 'chat', 'chat', 'image', 'image', 'music', 'tts', 'video', 'search']);
    expect(new Set(NATIVE_CAPABILITIES.map(capabilityKind)).has('custom')).toBe(false);
  });
});

const providerView = (override: Record<string, unknown> = {}): Record<string, unknown> => ({
  providerId: 'p1',
  slug: 'kie-ai',
  displayName: 'Kie.ai',
  protocol: 'kie-unified',
  baseUrl: 'https://api.kie.ai',
  domain: 'api.kie.ai',
  source: 'instance',
  enabled: true,
  authType: 'bearer',
  authHeaderName: null,
  key: { hasApiKey: true, keyHint: '....abcd' },
  customHeaderNames: [],
  models: [{ id: 'gpt-image', name: null, kinds: ['image'], contextWindow: null, maxOutput: null, origin: 'discovered' }],
  status: { state: 'cooldown', cooldownUntil: '2026-11-25T18:00:00.000Z', lastError: null, lastHttpStatus: 429, lastCheckedAt: null },
  ...override,
});

describe('fournisseurs', () => {
  const base = { displayName: 'Kie.ai', protocol: 'openai-chat', baseUrl: 'https://api.example.test/v1' };

  it('une création se lit telle quelle, la clé et le slug étant facultatifs', () => {
    expect(ProviderCreateSchema.parse(base)).toEqual(base);
    expect(ProviderCreateSchema.parse({ ...base, apiKey: TEST_KEY, slug: 'kie-ai', enabled: false })).toMatchObject({ slug: 'kie-ai', enabled: false });
  });

  it.each([
    ['un nom vide', { ...base, displayName: '   ' }],
    ['un nom trop long', { ...base, displayName: 'a'.repeat(81) }],
    ['un protocole inconnu', { ...base, protocol: 'websocket' }],
    ['une adresse trop courte', { ...base, baseUrl: 'abc' }],
    ['une adresse trop longue', { ...base, baseUrl: `https://a.test/${'p'.repeat(500)}` }],
    ['un slug en majuscules', { ...base, slug: 'Kie' }],
    ['un type d\u0027authentification inconnu', { ...base, authType: 'basic' }],
  ])('%s est refusé', (_label, value) => {
    expect(ProviderCreateSchema.safeParse(value).success).toBe(false);
  });

  it('une mise à jour accepte tout ou partie des champs, jamais le slug', () => {
    expect(ProviderUpdateSchema.parse({ displayName: '  Nouveau  ' })).toEqual({ displayName: 'Nouveau' });
    expect(ProviderUpdateSchema.parse({})).toEqual({});
    expect(Object.keys(ProviderUpdateSchema.shape)).not.toContain('slug');
  });

  it('une mise à jour à null retire la clé, les en-têtes ou la configuration', () => {
    expect(ProviderUpdateSchema.parse({ apiKey: null, customHeaders: null, extraConfig: null })).toEqual({ apiKey: null, customHeaders: null, extraConfig: null });
    expect(ProviderUpdateSchema.safeParse({ apiKey: 42 }).success).toBe(false);
  });

  it('une vue de fournisseur se lit, et son statut de clé ne porte que la présence et l\u0027indice', () => {
    const view = providerView();
    expect(ProviderViewSchema.parse(view)).toEqual(view);
    expect(Object.keys(ProviderViewSchema.parse({ ...view, [DISCARDED]: 'x' }).key)).toEqual(['hasApiKey', 'keyHint']);
  });

  it.each([
    ['une source inconnue', { source: 'team' }],
    ['un état inconnu', { status: { state: 'paused', cooldownUntil: null, lastError: null, lastHttpStatus: null, lastCheckedAt: null } }],
    ['un modèle sans origine', { models: [{ id: 'gpt-image', name: null, kinds: ['image'], contextWindow: null, maxOutput: null }] }],
    ['une clé absente de la vue', { key: undefined }],
    ['une clé absente du statut', { key: { hasApiKey: true } }],
  ])('une vue avec %s est refusée', (_label, override) => {
    expect(ProviderViewSchema.safeParse(providerView(override)).success).toBe(false);
  });
});

describe('routes de capacités', () => {
  const target = { providerId: 'p1', providerSlug: 'kie-ai', modelId: 'gpt-image' };

  it('lier : fournisseur et modèle requis, le reste facultatif', () => {
    expect(CapabilityBindSchema.parse({ providerId: 'p1', modelId: ' gpt-image ' })).toEqual({ providerId: 'p1', modelId: 'gpt-image' });
    expect(CapabilityBindSchema.parse({ providerId: 'p1', modelId: 'gpt-image', fallbackProviderId: null, params: { effort: 'low' } })).toEqual({
      providerId: 'p1',
      modelId: 'gpt-image',
      fallbackProviderId: null,
      params: { effort: 'low' },
    });
    expect(CapabilityBindSchema.safeParse({ providerId: '', modelId: 'gpt-image' }).success).toBe(false);
    expect(CapabilityBindSchema.safeParse({ providerId: 'p1', modelId: '   ' }).success).toBe(false);
  });

  it('délier n\u0027attend aucun champ', () => {
    expect(CapabilityUnbindSchema.parse({})).toEqual({});
  });

  it('une route : modèle principal et de repli, chacun pouvant manquer', () => {
    const unbound = { capability: 'image.generate', main: null, fallback: null, params: {}, followsDefault: false };
    expect(CapabilityRouteViewSchema.parse(unbound)).toEqual(unbound);
    expect(CapabilityRouteViewSchema.parse({ ...unbound, main: target, fallback: target, params: { size: '1k' }, followsDefault: true })).toMatchObject({
      main: target,
      fallback: target,
      followsDefault: true,
    });
    expect(CapabilityRouteViewSchema.safeParse({ ...unbound, capability: 'nope' }).success).toBe(false);
    expect(CapabilityRouteViewSchema.safeParse({ ...unbound, params: 'none' }).success).toBe(false);
  });
});

describe('règles du serveur', () => {
  it('un patch vide est refusé : il ne changerait rien', () => {
    expect(messagesOf(GuildRulesPatchSchema.safeParse({}))).toEqual(['Aucun champ à changer.']);
  });

  it.each([
    ['la règle de confirmation', { confirmDestructiveActions: true }],
    ['des salons bloqués', { blockedChannelIds: [CHANNEL_ID] }],
    ['une instruction ajoutée', { addCustomInstructions: ['Répondre en français'] }],
    ['une instruction retirée', { removeCustomInstructions: ['Répondre en anglais'] }],
  ])('%s se lit seul', (_label, patch) => {
    expect(GuildRulesPatchSchema.parse(patch)).toEqual(patch);
  });

  it.each([
    ['un identifiant trop court', { blockedChannelIds: ['12'] }],
    ['51 salons bloqués', { blockedChannelIds: Array.from({ length: 51 }, () => CHANNEL_ID) }],
    ['21 catégories libres', { freeCategoryIds: Array.from({ length: 21 }, () => CHANNEL_ID) }],
    ['11 instructions ajoutées', { addCustomInstructions: Array.from({ length: 11 }, () => 'Répondre en français') }],
    ['une instruction de 2 caractères', { addCustomInstructions: ['AB'] }],
    ['une instruction trop longue', { addCustomInstructions: ['a'.repeat(301)] }],
  ])('%s est refusé', (_label, patch) => {
    expect(GuildRulesPatchSchema.safeParse(patch).success).toBe(false);
  });

  it('les fenêtres d\u0027usage valent 24 heures, 7 jours et 30 jours', () => {
    expect(USAGE_WINDOWS.map((window) => USAGE_WINDOW_HOURS[window])).toEqual([24, 168, 720]);
  });
});

describe('ComponentLayoutSchema', () => {
  it('un titre ou une description suffit, et l\u0027un des deux est requis', () => {
    expect(messagesOf(ComponentLayoutSchema.safeParse({}))).toEqual(['Un titre ou une description est requis.']);
    for (const layout of [{ title: 'Seul' }, { description: 'Seule' }, { title: 'Les deux', description: 'Aussi' }]) {
      expect(ComponentLayoutSchema.safeParse(layout).success).toBe(true);
    }
  });

  it('au plus 10 rangées, de boutons ou de select', () => {
    const row = { kind: 'buttons', buttons: [{ label: 'Go' }] };
    expect(ComponentLayoutSchema.safeParse({ title: 'Titre', rows: Array.from({ length: 10 }, () => row) }).success).toBe(true);
    expect(ComponentLayoutSchema.safeParse({ title: 'Titre', rows: Array.from({ length: 11 }, () => row) }).success).toBe(false);
    expect(ComponentLayoutSchema.safeParse({ title: 'Titre', rows: [{ kind: 'menu' }] }).success).toBe(false);
    expect(ComponentLayoutSchema.safeParse({ title: 'Titre', accentColor: 0xd95926, footer: '10cordes' }).success).toBe(true);
    expect(ComponentLayoutSchema.safeParse({ title: 'Titre', thumbnailUrl: 'pas-une-adresse' }).success).toBe(false);
  });
});

describe('AssistantConfigSchema', () => {
  it('sans salon dédié par défaut : l\u0027assistant répond partout', () => {
    expect(AssistantConfigSchema.parse({})).toEqual({ channelId: '' });
  });

  it.each([
    ['un identifiant de salon', CHANNEL_ID],
    ['la chaîne vide', ''],
    ['un identifiant de 21 chiffres', '1'.repeat(21)],
  ])('%s se lit', (_label, channelId) => {
    expect(AssistantConfigSchema.parse({ channelId })).toEqual({ channelId });
  });

  it.each([
    ['du texte', 'general'],
    ['un identifiant trop court', '12345678901234'],
    ['un identifiant trop long', '1'.repeat(22)],
  ])('%s est refusé', (_label, channelId) => {
    expect(AssistantConfigSchema.safeParse({ channelId }).success).toBe(false);
  });
});

describe('identifiants du contrat', () => {
  it('un slug : minuscules, chiffres, tirets ou soulignés, 48 caractères au plus', () => {
    for (const slug of ['kie-ai', 'deepseek_official', 'a1', 'x'.repeat(48)]) expect(SlugSchema.safeParse(slug).success, slug).toBe(true);
    for (const slug of ['Kie', '-kie', 'kie ai', 'x'.repeat(49)]) expect(SlugSchema.safeParse(slug).success, slug).toBe(false);
  });

  it('un identifiant Discord compte de 15 à 21 chiffres', () => {
    expect(SnowflakeSchema.safeParse(CHANNEL_ID).success).toBe(true);
    for (const id of ['123', '1'.repeat(22), '15500000000000000ab', ` ${CHANNEL_ID}`]) expect(SnowflakeSchema.safeParse(id).success, id).toBe(false);
  });

  it('le statut d\u0027une clé : présente ou non, et un indice de 16 caractères au plus', () => {
    expect(KeyStatusSchema.parse({ hasApiKey: false, keyHint: null })).toEqual({ hasApiKey: false, keyHint: null });
    expect(KeyStatusSchema.safeParse({ hasApiKey: 'oui', keyHint: null }).success).toBe(false);
    expect(KeyStatusSchema.safeParse({ hasApiKey: true, keyHint: 'x'.repeat(17) }).success).toBe(false);
  });
});
