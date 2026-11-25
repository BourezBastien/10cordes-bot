import { describe, expect, it } from 'vitest';
import { apiKeyInput, providerCreateInput, providerUpdateInput } from './provider-input.mapper';

/**
 * Corps du contrat vers l'écriture du store. Ce que fixent ces tests : le
 * dashboard ne renvoie jamais la clé enregistrée (absente ou vide, le secret
 * est conservé ; `null` le retire), un champ absent ne change rien, et les
 * clés réservées d'un fournisseur ne se saisissent pas.
 */

// Clé factice, sans valeur utilisable.
const KEY = 'test-key-not-real';

const current = { slug: 'deepseek-official', protocol: 'openai-chat' as const, baseUrl: 'https://api.deepseek.com', authType: 'header' as const, authHeaderName: 'X-Api-Key' };

const base = { displayName: 'IA', protocol: 'openai-chat' as const, baseUrl: 'https://api.deepseek.com' };

describe('apiKeyInput', () => {
  it('absente ou vide : pas de nouvelle clé (le store conserve l\u0027actuelle) ; `null` la retire ; une autre chaîne est la nouvelle', () => {
    expect(apiKeyInput(undefined)).toBeUndefined();
    expect(apiKeyInput('')).toBeUndefined();
    expect(apiKeyInput(null)).toBeNull();
    expect(apiKeyInput(KEY)).toBe(KEY);
  });
});

describe('providerUpdateInput', () => {
  it('la clé absente, `undefined` ou vide conserve le secret ; `null` le retire', () => {
    expect(providerUpdateInput({ apiKey: undefined }, current).apiKey).toBeUndefined();
    expect(providerUpdateInput({}, current).apiKey).toBeUndefined();
    expect(providerUpdateInput({ apiKey: '' }, current).apiKey).toBeUndefined();
    expect(providerUpdateInput({ apiKey: null }, current).apiKey).toBeNull();
    expect(providerUpdateInput({ apiKey: KEY }, current).apiKey).toBe(KEY);
  });

  it('le slug ne change pas, et chaque champ absent laisse le réglage actuel', () => {
    expect(providerUpdateInput({}, current)).toEqual({ slug: current.slug, displayName: undefined, protocol: 'openai-chat', baseUrl: 'https://api.deepseek.com', apiKey: undefined, authType: 'header', authHeaderName: 'X-Api-Key', customHeaders: undefined, extraConfig: undefined, enabled: undefined });
    expect(providerUpdateInput({ displayName: 'Nouveau nom', protocol: 'anthropic-messages', enabled: false, authHeaderName: null }, current)).toMatchObject({ slug: current.slug, displayName: 'Nouveau nom', protocol: 'anthropic-messages', baseUrl: current.baseUrl, authType: 'header', authHeaderName: null, enabled: false });
  });

  it('en-têtes et options : absents ou vides, les actuels sont conservés ; `null` les retire', () => {
    expect(providerUpdateInput({}, current).customHeaders).toBeUndefined();
    expect(providerUpdateInput({ customHeaders: {} }, current).customHeaders).toBeUndefined();
    expect(providerUpdateInput({ customHeaders: { 'X-Title': 'bot' } }, current).customHeaders).toEqual({ 'X-Title': 'bot' });
    expect(providerUpdateInput({ extraConfig: {} }, current).extraConfig).toBeUndefined();
    expect(providerUpdateInput({ customHeaders: null, extraConfig: null }, current)).toMatchObject({ customHeaders: null, extraConfig: null });
  });

  it('les clés réservées ne se saisissent pas : elles marquent l\u0027origine d\u0027un fournisseur', () => {
    expect(providerUpdateInput({ extraConfig: { _source: 'instance:llm', _model: 'x', maxTokens: 4096 } }, current).extraConfig).toEqual({ maxTokens: 4096 });
    // Réduites à leurs clés réservées, les options ne disent rien : les actuelles sont conservées.
    expect(providerUpdateInput({ extraConfig: { _source: 'instance:llm' } }, current).extraConfig).toBeUndefined();
  });
});

describe('providerCreateInput', () => {
  it('le corps devient une création ; sans clé, rien à chiffrer', () => {
    expect(providerCreateInput({ displayName: 'IA', protocol: 'openai-chat', baseUrl: 'https://api.deepseek.com' }, 'ia')).toEqual({
      slug: 'ia',
      displayName: 'IA',
      protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      apiKey: undefined,
      authType: undefined,
      authHeaderName: undefined,
      customHeaders: undefined,
      extraConfig: undefined,
      enabled: undefined,
    });
    expect(providerCreateInput({ ...base, apiKey: '' }, 'ia').apiKey).toBeUndefined();
    expect(providerCreateInput({ ...base, apiKey: KEY }, 'ia').apiKey).toBe(KEY);
  });

  it('les clés réservées sont retirées des options', () => {
    expect(providerCreateInput({ ...base, extraConfig: { _source: 'instance:kie', operations: {} } }, 'ia').extraConfig).toEqual({ operations: {} });
  });
});
