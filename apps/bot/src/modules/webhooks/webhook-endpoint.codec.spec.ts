import { describe, expect, it } from 'vitest';
import { encryptSecret } from '../../shared/crypto/secret-box';
import type { ProviderSecrets } from '../providers/provider-store.codec';
import {
  assertHeaderRecord,
  authTypeOf,
  decodeSecretHeaders,
  encodeSecretHeaders,
  headerRecordIssue,
  isHeaderName,
  methodOf,
  parseHeaderRecord,
  publicHeadersJsonOf,
  summaryOf,
  webhookFromRow,
} from './webhook-endpoint.codec';
import { WebhookEndpointError } from './webhook-endpoint.errors';
import { SECRET_HEADER_VALUE, TEST_KEY, webhookRow } from './webhook.fake-store';

/**
 * Lecture d'une ligne de connecteur. Trois règles fixées ici : un en-tête
 * secret ne se relit que déchiffré et bien formé (toute autre colonne se lit
 * comme vide, sans lever), un nom ou une valeur d'en-tête non envoyable est
 * refusé à l'écriture sans jamais montrer la valeur, et la forme sans secret
 * d'un connecteur n'en porte que les noms.
 */

const SECRETS: ProviderSecrets = { token: 'x', encryption: TEST_KEY };
const OTHER_SECRETS: ProviderSecrets = { token: 'x', encryption: 'another-test-key-not-real' };

const issueOf = (headers: Record<string, string>): string | null => headerRecordIssue(headers);

describe('en-têtes secrets', () => {
  it('un objet JSON chiffré, relu à l\u0027identique ; aucun en-tête : rien à stocker', () => {
    const ciphertext = encodeSecretHeaders({ 'X-Api-Key': SECRET_HEADER_VALUE }, SECRETS);
    expect(ciphertext).toMatch(/^v1:/u);
    expect(ciphertext).not.toContain(TEST_KEY);
    expect(decodeSecretHeaders(ciphertext, SECRETS)).toEqual({ 'X-Api-Key': SECRET_HEADER_VALUE });
    expect(encodeSecretHeaders({}, SECRETS)).toBeNull();
  });

  it('une colonne absente se lit comme un enregistrement vide', () => {
    expect(decodeSecretHeaders(null, SECRETS)).toEqual({});
    expect(decodeSecretHeaders(undefined, SECRETS)).toEqual({});
    expect(decodeSecretHeaders('', SECRETS)).toEqual({});
  });

  it('indéchiffrable (autre clé maîtresse) : enregistrement vide, sans lever', () => {
    const ciphertext = encodeSecretHeaders({ Authorization: SECRET_HEADER_VALUE }, SECRETS);
    expect(decodeSecretHeaders(ciphertext, OTHER_SECRETS)).toEqual({});
    expect(decodeSecretHeaders('v1:pas:du:base64', SECRETS)).toEqual({});
  });

  it('mal formée : JSON invalide, tableau, valeurs non textuelles', () => {
    expect(decodeSecretHeaders(encryptSecret('pas du json', SECRETS), SECRETS)).toEqual({});
    expect(decodeSecretHeaders(encryptSecret('[1,2]', SECRETS), SECRETS)).toEqual({});
    expect(decodeSecretHeaders(encryptSecret('{"X-Api-Key":42}', SECRETS), SECRETS)).toEqual({});
  });

  it('du texte en clair dans la colonne n\u0027est jamais pris pour un secret', () => {
    expect(decodeSecretHeaders(JSON.stringify({ Authorization: SECRET_HEADER_VALUE }), SECRETS)).toEqual({});
  });
});

describe('en-têtes publics', () => {
  it('un objet JSON, ou null quand il n\u0027y en a aucun', () => {
    expect(publicHeadersJsonOf({ 'X-Public': '1' })).toBe('{"X-Public":"1"}');
    expect(publicHeadersJsonOf({})).toBeNull();
  });

  it('lus d\u0027une colonne : un objet de chaînes, sinon null', () => {
    expect(parseHeaderRecord('{"a":"x","b":"y"}')).toEqual({ a: 'x', b: 'y' });
    expect(parseHeaderRecord(null)).toBeNull();
    expect(parseHeaderRecord('')).toBeNull();
    expect(parseHeaderRecord('pas du json')).toBeNull();
    expect(parseHeaderRecord('{"a":1}')).toBeNull();
    expect(parseHeaderRecord('"x"')).toBeNull();
  });

  it('une clé `__proto__` reste une propriété propre : le prototype n\u0027est pas touché', () => {
    const record = parseHeaderRecord('{"__proto__":"x","a":"y"}');
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    expect(Object.keys(record ?? {})).toEqual(['__proto__', 'a']);
    expect(record?.a).toBe('y');
  });
});

describe('contrôle des en-têtes', () => {
  it('un nom est un jeton HTTP de 1 à 60 caractères', () => {
    expect(isHeaderName('Authorization')).toBe(true);
    expect(isHeaderName('X-Api-Key')).toBe(true);
    expect(isHeaderName('A'.repeat(60))).toBe(true);
    for (const name of ['', 'X Bad', 'X-Bad\r\n', 'é', 'A'.repeat(61), ' X-Ok']) expect(isHeaderName(name)).toBe(false);
  });

  it('des en-têtes envoyables passent (tabulation et accents compris)', () => {
    expect(issueOf({ 'X-Ok': 'a\tbé', Authorization: 'Bearer x' })).toBeNull();
  });

  const REFUSED: Array<[string, Record<string, string>]> = [
    ['nom avec espace', { 'X Bad': 'v' }],
    ['nom vide', { '': 'v' }],
    ['nom trop long', { [String('A').repeat(61)]: 'v' }],
    ['saut de ligne dans la valeur', { 'X-Ok': 'a\r\nInjected: 1' }],
    ['caractère de contrôle', { 'X-Ok': 'a\u0000b' }],
    ['caractère hors Latin-1', { 'X-Ok': 'a😀b' }],
    ['valeur trop longue', { 'X-Ok': 'A'.repeat(1001) }],
  ];

  it.each(REFUSED)('%s : refusé', (_label, headers) => {
    expect(issueOf(headers)).not.toBeNull();
  });

  it('le refus nomme l\u0027en-tête, jamais sa valeur', () => {
    const issue = issueOf({ 'X-Ok': `a\r\n${TEST_KEY}` });
    expect(issue).toContain('X-Ok');
    expect(issue).not.toContain(TEST_KEY);
  });

  it('à l\u0027écriture : noms nettoyés, ou erreur typée', () => {
    expect(assertHeaderRecord({ ' X-Ok ': 'v' }, 'En-têtes publics')).toEqual({ 'X-Ok': 'v' });
    let caught: unknown;
    try {
      assertHeaderRecord({ 'X-Ok': `a\r\n${TEST_KEY}` }, 'En-têtes secrets');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WebhookEndpointError);
    expect(caught).toMatchObject({ kind: 'invalid' });
    expect((caught as Error).message).toContain('En-têtes secrets');
    expect((caught as Error).message).not.toContain(TEST_KEY);
  });
});

describe('webhookFromRow', () => {
  it('déchiffre les en-têtes secrets, lit les colonnes JSON, garde les statuts et les dates', () => {
    const checkedAt = new Date('2026-11-25T11:00:00.000Z');
    const endpoint = webhookFromRow(
      webhookRow({
        method: 'PATCH',
        authType: 'header',
        authHeaderName: 'X-Api-Key',
        encryptedHeaders: encodeSecretHeaders({ 'X-Api-Key': SECRET_HEADER_VALUE }, SECRETS),
        publicHeadersJson: '{"X-Public":"1"}',
        requestTemplateJson: '{"text":"{{payload.text}}"}',
        responseExtractPath: 'data.id',
        lastHttpStatus: 200,
        lastCheckedAt: checkedAt,
        lastError: 'HTTP 500',
      }),
      SECRETS,
    );
    expect(endpoint).toMatchObject({
      id: 'wh_1',
      method: 'PATCH',
      authType: 'header',
      authHeaderName: 'X-Api-Key',
      secretHeaders: { 'X-Api-Key': SECRET_HEADER_VALUE },
      publicHeaders: { 'X-Public': '1' },
      requestTemplate: { text: '{{payload.text}}' },
      responseExtractPath: 'data.id',
      enabled: true,
      lastHttpStatus: 200,
      lastCheckedAt: checkedAt,
      lastError: 'HTTP 500',
      createdAt: new Date('2026-11-25T10:00:00.000Z'),
    });
  });

  it('une valeur inconnue retombe sur le défaut ; une colonne JSON illisible se lit vide', () => {
    const endpoint = webhookFromRow(webhookRow({ method: 'TRACE', authType: 'basic', publicHeadersJson: '{pas du json', requestTemplateJson: '{pas du json' }), SECRETS);
    expect(endpoint.method).toBe('POST');
    expect(endpoint.authType).toBe('none');
    expect(endpoint.publicHeaders).toEqual({});
    expect(endpoint.requestTemplate).toBeNull();
    expect(webhookFromRow(webhookRow(), SECRETS).requestTemplate).toBeNull();
    expect(methodOf('DELETE')).toBe('DELETE');
    expect(authTypeOf('bearer')).toBe('bearer');
  });
});

describe('summaryOf', () => {
  it('retire les en-têtes secrets et ne garde que leurs noms, triés', () => {
    const endpoint = webhookFromRow(
      webhookRow({ encryptedHeaders: encodeSecretHeaders({ 'Z-Last': SECRET_HEADER_VALUE, 'A-First': SECRET_HEADER_VALUE }, SECRETS) }),
      SECRETS,
    );
    const summary = summaryOf(endpoint);
    expect(summary.secretHeaderNames).toEqual(['A-First', 'Z-Last']);
    expect(summary).not.toHaveProperty('secretHeaders');
    expect(JSON.stringify(summary)).not.toContain(TEST_KEY);
    expect(JSON.stringify(summary)).not.toContain('Bearer');
  });
});
