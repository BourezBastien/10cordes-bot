import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../provider.types';
import { parseAdvancedConfig, providerFormValues } from './provider-hub.form';
import { slugFromName, slugForProvider, uniqueSlug } from './provider-hub.slug';

/**
 * Forme du formulaire « Fournisseur IA » : slug déduit du nom, config avancée
 * (aller-retour entre le champ JSON et les colonnes du fournisseur). Fonctions
 * pures, aucune doublure.
 */

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';

/** Clé fictive, sans valeur utilisable. */
const SECRET = 'test-key-not-real';

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'cmProviderId0000000000000',
    guildId: '1550000000000000001',
    slug: 'openrouter',
    displayName: 'OpenRouter',
    protocol: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    authType: 'bearer',
    authHeaderName: null,
    apiKey: SECRET,
    customHeaders: {},
    extraConfig: {},
    models: [],
    enabled: true,
    ...overrides,
  };
}

const inputIds = (values: Record<string, string>): string[] => Object.entries(parseAdvancedConfig(JSON.stringify(values)))
  .filter(([, value]) => value !== undefined)
  .map(([key]) => key);

describe('slug d\u0027un fournisseur', () => {
  it.each([
    ['', ''],
    ['***', ''],
    ['a', 'a'],
    ["L'IA", 'lia'],
    ['Déjà vu', 'deja-vu'],
    ['OpenRouter  ', 'openrouter'],
    ['  --Toto--  ', 'toto'],
  ])('« %s » donne « %s »', (typed, slug) => {
    expect(slugFromName(typed)).toBe(slug);
  });

  it('un nom sans lettres ni chiffres est refusé, pas transformé en slug vide', () => {
    expect(() => slugForProvider('***')).toThrow('Nom invalide');
    expect(slugForProvider('Kie.ai')).toBe('kie-ai');
  });

  it('un slug pris reçoit le suffixe libre suivant', () => {
    expect(uniqueSlug('kie', new Set())).toBe('kie');
    expect(uniqueSlug('kie', new Set(['kie']))).toBe('kie-2');
    expect(uniqueSlug('kie', new Set(['kie', 'kie-2', 'kie-4']))).toBe('kie-3');
  });
});

describe('config avancée', () => {
  it('vide : rien', () => {
    expect(parseAdvancedConfig('')).toEqual({});
    expect(parseAdvancedConfig('   ')).toEqual({});
  });

  it('sépare l\u0027authentification et les en-têtes des options', () => {
    const parsed = parseAdvancedConfig('{"authType":"query","authHeaderName":"api_key","customHeaders":{"X-Org":"acme"},"temperature":0.2}');
    expect(parsed).toEqual({ authType: 'query', authHeaderName: 'api_key', customHeaders: { 'X-Org': 'acme' }, extraConfig: { temperature: 0.2 } });
  });

  it.each(['{', '[1]', '"texte"', 'null', '5'])('« %s » : refusé, jamais une config muette', (raw) => {
    expect(() => parseAdvancedConfig(raw)).toThrow('Config avancée invalide');
  });
});

describe('champs de modification', () => {
  it('nom affiché, protocole et URL ; la clé n\u0027en fait jamais partie', () => {
    const values = providerFormValues(provider());
    expect(values).toEqual({ [NAME]: 'OpenRouter', protocol: 'openai-chat', baseUrl: 'https://openrouter.ai/api/v1', advanced: '' });
    expect(JSON.stringify(values)).not.toContain(SECRET);
  });

  it('sans nom affiché, le slug sert de nom', () => {
    expect(providerFormValues(provider({ displayName: '' }))[NAME]).toBe('openrouter');
  });

  it('l\u0027authentification non implicite et les en-têtes sont montrés, les clés réservées jamais', () => {
    const values = providerFormValues(provider({ authType: 'header', authHeaderName: 'X-API-Key', customHeaders: { 'X-Org': 'acme' }, extraConfig: { _source: 'instance:llm', temperature: 0.3 } }));
    expect(values.advanced).toBe('{"temperature":0.3,"authType":"header","authHeaderName":"X-API-Key","customHeaders":{"X-Org":"acme"}}');
    // L'aller-retour rend ce que le formulaire avait reçu.
    expect(inputIds(JSON.parse(values.advanced ?? '{}'))).toEqual(['authType', 'authHeaderName', 'customHeaders', 'extraConfig']);
    expect(JSON.stringify(parseAdvancedConfig(values.advanced ?? ''))).not.toContain('instance:llm');
  });
});
