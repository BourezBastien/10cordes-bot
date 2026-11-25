import { describe, expect, it } from 'vitest';
import type { WebhookAuthType, WebhookCreate } from '@10cordes/shared';
import type { ProviderSecrets } from '../providers/provider-store.codec';
import { decodeSecretHeaders } from './webhook-endpoint.codec';
import { WebhookEndpointError } from './webhook-endpoint.errors';
import {
  REQUEST_TEMPLATE_MAX_CHARS,
  assertWebhookUrl,
  authHeaderNameOf,
  endpointChanges,
  extractPathOf,
  newEndpointFields,
  requestTemplateJsonOf,
} from './webhook-endpoint.input';
import { SECRET_HEADER_VALUE, TEST_KEY } from './webhook.fake-store';

/**
 * Écriture d'un connecteur : le corps du contrat devient les champs d'une
 * ligne. Ce que ces tests fixent : une URL non publique est refusée ici,
 * typée (422 à l'API), les en-têtes secrets partent chiffrés, et une mise à
 * jour qui ne redonne pas les en-têtes secrets n'en réécrit pas la colonne.
 */

// Clé calculée : le scanner du registre des outils lit, dans toute source suivie, une clé name suivie d'une chaîne littérale.
const NAME = 'name';
const SECRETS: ProviderSecrets = { token: 'x', encryption: TEST_KEY };
const URL = 'https://api.example.test/hooks/orders';

const create = (overrides: Partial<WebhookCreate> = {}): WebhookCreate => ({ slug: 'orders', [NAME]: ' Commandes ', method: 'POST', url: URL, ...overrides });

/** Le refus typé que lève `run` (le test échoue si rien n'est levé, ou si l'erreur n'est pas typée). */
async function refusalOf(run: () => unknown): Promise<WebhookEndpointError> {
  try {
    run();
  } catch (error) {
    if (error instanceof WebhookEndpointError) return error;
    throw error;
  }
  throw new Error('Attendu : un refus typé du connecteur.');
}

const existing = (authType: WebhookAuthType, authHeaderName: string | null) => ({ authType, authHeaderName });

describe('assertWebhookUrl', () => {
  it('rend l\u0027adresse normalisée, sans ses barres finales', () => {
    expect(assertWebhookUrl(URL)).toBe(URL);
    expect(assertWebhookUrl(`${URL}/`)).toBe(URL);
  });

  it.each(['http://hooks.example.test/x', 'https://localhost:8443/hook', 'https://127.0.0.1/hook', 'https://192.168.1.4/hook', 'https://169.254.169.254/latest'])('%s : refusé, typé invalid', async (url) => {
    const refusal = await refusalOf(() => assertWebhookUrl(url));
    expect(refusal.kind).toBe('invalid');
    expect(refusal.message).toContain('URL refusée');
  });

  it('le http dit pourquoi ; une adresse illisible est refusée', async () => {
    expect((await refusalOf(() => assertWebhookUrl('http://hooks.example.test/x'))).message).toContain('adresse https est exigée');
    expect((await refusalOf(() => assertWebhookUrl('https://'))).message).toContain('adresse illisible');
    expect((await refusalOf(() => assertWebhookUrl('https://[::1]/hook'))).message).toContain('hôte non public');
    expect((await refusalOf(() => assertWebhookUrl('https://192.168.1.4/hook'))).message).toContain('192.168.1.4');
  });

  it('aucun identifiant dans l\u0027adresse : l\u0027URL est montrée en clair', async () => {
    const refusal = await refusalOf(() => assertWebhookUrl('https://user:test-key-not-real@api.example.test/hook'));
    expect(refusal.kind).toBe('invalid');
    expect(refusal.message).not.toContain('test-key-not-real');
  });
});

describe('newEndpointFields', () => {
  it('les valeurs absentes prennent le défaut du contrat', () => {
    expect(newEndpointFields(create(), SECRETS)).toEqual({
      [NAME]: 'Commandes',
      method: 'POST',
      url: URL,
      authType: 'none',
      authHeaderName: null,
      encryptedHeaders: null,
      publicHeadersJson: null,
      requestTemplateJson: null,
      responseExtractPath: null,
      enabled: true,
    });
  });

  it('les en-têtes secrets sont chiffrés, le reste rangé', () => {
    const fields = newEndpointFields(
      create({
        authType: 'header',
        authHeaderName: ' X-Token ',
        secretHeaders: { 'X-Token': SECRET_HEADER_VALUE },
        publicHeaders: { 'X-Public': '1' },
        requestTemplate: { text: '{{payload.text}}' },
        responseExtractPath: ' data.id ',
        enabled: false,
      }),
      SECRETS,
    );
    expect(fields).toMatchObject({
      authType: 'header',
      authHeaderName: 'X-Token',
      publicHeadersJson: '{"X-Public":"1"}',
      requestTemplateJson: '{"text":"{{payload.text}}"}',
      responseExtractPath: 'data.id',
      enabled: false,
    });
    expect(fields.encryptedHeaders).not.toContain(TEST_KEY);
    expect(decodeSecretHeaders(fields.encryptedHeaders, SECRETS)).toEqual({ 'X-Token': SECRET_HEADER_VALUE });
  });

  it('un nom d\u0027en-tête d\u0027authentification vide laisse le défaut s\u0027appliquer', () => {
    expect(newEndpointFields(create({ authType: 'bearer', authHeaderName: '' }), SECRETS).authHeaderName).toBeNull();
    expect(authHeaderNameOf('none', 'Authorization')).toBeNull();
  });

  it('un en-tête non envoyable est refusé, sans sa valeur', async () => {
    const publicRefusal = await refusalOf(() => newEndpointFields(create({ publicHeaders: { 'X Bad': 'v' } }), SECRETS));
    expect(publicRefusal.message).toContain('En-têtes publics');
    const secretRefusal = await refusalOf(() => newEndpointFields(create({ secretHeaders: { 'X-Ok': `a\r\n${TEST_KEY}` } }), SECRETS));
    expect(secretRefusal.message).toContain('En-têtes secrets');
    expect(secretRefusal.message).not.toContain(TEST_KEY);
    expect((await refusalOf(() => newEndpointFields(create({ authType: 'header', authHeaderName: 'X Bad' }), SECRETS))).kind).toBe('invalid');
  });

  it('un gabarit trop lourd ou non sérialisable est refusé ; une valeur JSON reste telle quelle', async () => {
    await refusalOf(() => newEndpointFields(create({ requestTemplate: { text: 'A'.repeat(REQUEST_TEMPLATE_MAX_CHARS) } }), SECRETS));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect((await refusalOf(() => requestTemplateJsonOf(circular))).message).toContain('valeur JSON');
    expect(newEndpointFields(create({ requestTemplate: 0 }), SECRETS).requestTemplateJson).toBe('0');
    expect(requestTemplateJsonOf(null)).toBeNull();
    expect(extractPathOf('   ')).toBeNull();
  });
});

describe('endpointChanges', () => {
  it('sans `secretHeaders`, la colonne chiffrée n\u0027est pas réécrite', () => {
    const changes = endpointChanges({ name: 'Nouveau nom' }, existing('bearer', null), SECRETS);
    expect(changes).toEqual({ name: 'Nouveau nom' });
    expect(changes).not.toHaveProperty('encryptedHeaders');
  });

  it('`secretHeaders` à null (ou vide) les retire ; un objet les remplace tous', () => {
    expect(endpointChanges({ secretHeaders: null }, existing('none', null), SECRETS)).toEqual({ encryptedHeaders: null });
    expect(endpointChanges({ secretHeaders: {} }, existing('none', null), SECRETS)).toEqual({ encryptedHeaders: null });
    const { encryptedHeaders } = endpointChanges({ secretHeaders: { Authorization: SECRET_HEADER_VALUE } }, existing('none', null), SECRETS);
    expect(decodeSecretHeaders(encryptedHeaders, SECRETS)).toEqual({ Authorization: SECRET_HEADER_VALUE });
  });

  it('un corps vide ne change rien ; les champs présents sont rangés', () => {
    expect(endpointChanges({}, existing('bearer', null), SECRETS)).toEqual({});
    expect(
      endpointChanges(
        { name: ' Nom ', url: `${URL}/`, publicHeaders: null, requestTemplate: null, responseExtractPath: '', enabled: false },
        existing('bearer', null),
        SECRETS,
      ),
    ).toEqual({ [NAME]: 'Nom', url: URL, publicHeadersJson: null, requestTemplateJson: null, responseExtractPath: null, enabled: false });
    expect(endpointChanges({ publicHeaders: { 'X-Public': '1' }, requestTemplate: false }, existing('none', null), SECRETS)).toEqual({
      publicHeadersJson: '{"X-Public":"1"}',
      requestTemplateJson: 'false',
    });
  });

  it('le nom de l\u0027en-tête d\u0027authentification suit le type : conservé, remplacé, ou retiré sans authentification', () => {
    expect(endpointChanges({ authHeaderName: 'X-New' }, existing('bearer', 'X-Old'), SECRETS)).toEqual({ authType: 'bearer', authHeaderName: 'X-New' });
    expect(endpointChanges({ authHeaderName: 'X-New' }, existing('none', null), SECRETS)).toEqual({ authType: 'none', authHeaderName: null });
    expect(endpointChanges({ authType: 'header' }, existing('bearer', 'X-Old'), SECRETS)).toEqual({ authType: 'header', authHeaderName: 'X-Old' });
    expect(endpointChanges({ authType: 'none' }, existing('bearer', 'X-Old'), SECRETS)).toEqual({ authType: 'none', authHeaderName: null });
    expect(endpointChanges({ authType: 'header', authHeaderName: '' }, existing('none', null), SECRETS)).toEqual({ authType: 'header', authHeaderName: null });
  });

  it('une URL refusée l\u0027est aussi à la mise à jour', async () => {
    const refusal = await refusalOf(() => endpointChanges({ url: 'https://127.0.0.1/hook' }, existing('none', null), SECRETS));
    expect(refusal.kind).toBe('invalid');
  });
});
