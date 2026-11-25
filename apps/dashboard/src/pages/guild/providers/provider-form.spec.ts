import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { buildCreate, buildUpdate, EMPTY_FORM, initialForm, isAdvanced, parseAdvanced, validateProvider, type ProviderForm } from '@/pages/guild/providers/provider-form';
import { providerView } from '@/test/fixtures';

/*
 * Formulaire d'un fournisseur : la clé vide est conservée en édition, la
 * case la retire, et seuls les champs qui changent partent. Le `t` des
 * contrôles ne fait que rendre la clé lisible : les assertions lisent la clé.
 */

const SECRET = 'test-key-not-real';

const t = ((key: string) => key) as unknown as TFunction;

const REASONS = { object: 'OBJET', headers: 'EN-TETES' };

function form(overrides: Partial<ProviderForm> = {}): ProviderForm {
  return {
    ...EMPTY_FORM,
    displayName: 'OpenAI',
    slug: 'openai-main',
    baseUrl: 'https://api.openai.com/v1',
    ...overrides,
  };
}

describe('parseAdvanced', () => {
  it('vide, elle ne change rien', () => {
    expect(parseAdvanced('   ', REASONS)).toEqual({});
    expect(isAdvanced(parseAdvanced('', REASONS))).toBe(true);
  });

  it('sépare customHeaders du reste', () => {
    expect(parseAdvanced('{"customHeaders": {"X-Org": "a"}, "temperature": 0.2}', REASONS)).toEqual({
      customHeaders: { 'X-Org': 'a' },
      extraConfig: { temperature: 0.2 },
    });
  });

  it('refuse un JSON illisible, un non-objet, et des en-têtes qui ne sont pas des chaînes', () => {
    expect(parseAdvanced('{oops', REASONS)).toHaveProperty('error');
    expect(parseAdvanced('[1, 2]', REASONS)).toEqual({ error: 'OBJET' });
    expect(parseAdvanced('{"customHeaders": {"X": 3}}', REASONS)).toEqual({ error: 'EN-TETES' });
  });
});

describe('validateProvider', () => {
  it('accepte une saisie complète', () => {
    expect(validateProvider(form(), t)).toEqual({});
  });

  it('signale le nom vide, un slug mal formé et une adresse non https ou privée', () => {
    expect(validateProvider(form({ displayName: '  ' }), t)).toEqual({ displayName: 'providers.sheet.nameRequired' });
    expect(validateProvider(form({ slug: 'Mon Slug' }), t)).toEqual({ slug: 'providers.sheet.slugInvalid' });
    expect(validateProvider(form({ baseUrl: 'http://api.openai.com/v1' }), t)).toEqual({ baseUrl: 'providers.sheet.baseUrlInvalid' });
    expect(validateProvider(form({ baseUrl: 'https://localhost/v1' }), t)).toEqual({ baseUrl: 'providers.sheet.baseUrlInvalid' });
  });
});

describe('buildCreate', () => {
  it('n’envoie la clé, le slug et les options que s’ils sont remplis', () => {
    expect(buildCreate(form({ slug: '' }), {})).toEqual({
      displayName: 'OpenAI',
      protocol: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      authType: 'bearer',
      enabled: true,
    });
    expect(buildCreate(form(), {}).slug).toBe('openai-main');
  });

  it('emporte la clé saisie (moins ses espaces) et la config avancée', () => {
    const body = buildCreate(form({ apiKey: ` ${SECRET} ` }), { customHeaders: { 'X-Org': 'a' } });
    expect(body.apiKey).toBe(SECRET);
    expect(body.customHeaders).toEqual({ 'X-Org': 'a' });
  });

  it('nomme l’en-tête d’authentification pour un type « header »', () => {
    expect(buildCreate(form({ authType: 'header', authHeaderName: 'X-Key' }), {}).authHeaderName).toBe('X-Key');
  });
});

describe('buildUpdate', () => {
  const view = providerView({ displayName: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', key: { hasApiKey: true, keyHint: '••••4242' } });
  const base = initialForm({ mode: 'edit', provider: view });

  it('rien d’envoyé si rien ne change', () => {
    expect(buildUpdate(view, base, {})).toEqual({});
  });

  it('une clé laissée vide conserve la clé enregistrée : absente du corps', () => {
    const body = buildUpdate(view, { ...base, displayName: 'DeepSeek Pro' }, {});
    expect('apiKey' in body).toBe(false);
    expect(body.displayName).toBe('DeepSeek Pro');
  });

  it('la case « retirer la clé » envoie null, mais seulement s’il y en a une', () => {
    expect(buildUpdate(view, { ...base, removeKey: true }, {}).apiKey).toBeNull();
    const bare = providerView({ key: { hasApiKey: false, keyHint: null } });
    expect('apiKey' in buildUpdate(bare, { ...initialForm({ mode: 'edit', provider: bare }), removeKey: true }, {})).toBe(false);
  });

  it('une clé saisie remplace l’ancienne, et la case de retrait ne compte plus', () => {
    expect(buildUpdate(view, { ...base, apiKey: SECRET, removeKey: true }, {}).apiKey).toBe(SECRET);
  });
});
