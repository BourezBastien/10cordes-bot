import { describe, expect, it } from 'vitest';
import type { WebhookEndpoint } from './webhook-endpoint.codec';
import { EXTRACTED_MAX_CHARS, buildWebhookRequest, extractResponseValue, renderRequestTemplate, valueAtPath } from './webhook-request.builder';
import { SECRET_HEADER_VALUE, TEST_KEY } from './webhook.fake-store';

/**
 * Gabarit de la requête d'un connecteur. Ce que ces tests fixent : le corps
 * vient du gabarit et de la charge utile (types conservés, GET et DELETE sans
 * corps), l'identifiant est un en-tête secret (convention bearer / header),
 * et un connecteur authentifié n'est jamais monté sans son identifiant.
 */

// Clé calculée : le scanner du registre des outils lit, dans toute source suivie, une clé name suivie d'une chaîne littérale.
const NAME = 'name';
const NOW = new Date('2026-11-25T10:00:00.000Z');
const URL = 'https://api.example.test/hooks/orders';
const RAW_TOKEN = TEST_KEY;

const endpoint = (overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint => ({
  id: 'wh_1',
  guildId: 'g',
  slug: 'orders',
  [NAME]: 'Commandes',
  method: 'POST',
  url: URL,
  authType: 'none',
  authHeaderName: null,
  secretHeaders: {},
  publicHeaders: {},
  requestTemplate: null,
  responseExtractPath: null,
  enabled: true,
  lastHttpStatus: null,
  lastCheckedAt: null,
  lastError: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const TEMPLATE = {
  id: '{{payload.order.id}}',
  label: 'Commande {{payload.order.id}} de {{payload.customer}}',
  objet: '{{payload.order}}',
  texte: 'Objet {{payload.order}}',
  absent: '{{payload.nope.deep}}',
  enLigneAbsent: 'X{{payload.nope}}Y',
  liste: ['{{payload.order.id}}'],
  zero: 0,
  fixe: '{{ payload }}',
};
const PAYLOAD = { order: { id: 7 }, customer: 'Alice' };

/** La requête montée ; le test échoue si le gabarit est refusé. */
function planOf(connector: WebhookEndpoint, payload: Record<string, unknown> = {}) {
  const built = buildWebhookRequest(connector, payload);
  if (!built.ok) throw new Error(`Gabarit refusé : ${built.summary}`);
  return built.request;
}

describe('corps de la requête', () => {
  it('`{{payload}}` seul reçoit la charge utile entière, types conservés', () => {
    const request = planOf(endpoint({ requestTemplate: { data: '{{payload}}', fixe: 'x' } }), { text: 'Salut l\u0027ami', n: 2, nested: { ok: true } });
    expect(JSON.parse(request.body ?? 'null')).toEqual({ data: { text: 'Salut l\u0027ami', n: 2, nested: { ok: true } }, fixe: 'x' });
    const whole = planOf(endpoint({ requestTemplate: '{{payload}}' }), PAYLOAD);
    expect(JSON.parse(whole.body ?? 'null')).toEqual(PAYLOAD);
  });

  it('`{{payload.a.b}}` reçoit la valeur du chemin : valeur seule, ou en forme texte dans un texte', () => {
    const request = planOf(endpoint({ requestTemplate: TEMPLATE }), PAYLOAD);
    expect(JSON.parse(request.body ?? 'null')).toEqual({
      id: 7,
      label: 'Commande 7 de Alice',
      objet: { id: 7 },
      texte: 'Objet {"id":7}',
      absent: null,
      enLigneAbsent: 'XY',
      liste: [7],
      zero: 0,
      fixe: '{{ payload }}',
    });
  });

  it('un gabarit tableau ou scalaire est rendu tel quel', () => {
    expect(planOf(endpoint({ requestTemplate: ['{{payload.order.id}}', 1] }), PAYLOAD).body).toBe('[7,1]');
    expect(planOf(endpoint({ requestTemplate: 'sans marqueur' }), PAYLOAD).body).toBe('"sans marqueur"');
    expect(renderRequestTemplate({ a: { b: ['{{payload.k}}'] } }, { k: 'v' })).toEqual({ a: { b: ['v'] } });
  });

  it('GET et DELETE n\u0027envoient aucun corps, ni type de contenu, même avec un gabarit', () => {
    for (const method of ['GET', 'DELETE'] as const) {
      const request = planOf(endpoint({ method, requestTemplate: TEMPLATE }), PAYLOAD);
      expect(request.method).toBe(method);
      expect(request.body).toBeNull();
      expect(request.headers).not.toHaveProperty('Content-Type');
    }
  });

  it('sans gabarit, aucune méthode n\u0027envoie de corps', () => {
    for (const method of ['POST', 'PUT', 'PATCH'] as const) {
      const request = planOf(endpoint({ method }), PAYLOAD);
      expect(request.body).toBeNull();
      expect(request.headers).not.toHaveProperty('Content-Type');
    }
  });

  it('avec un corps : `Content-Type: application/json`, sauf si un en-tête du connecteur en donne déjà un', () => {
    expect(planOf(endpoint({ requestTemplate: TEMPLATE }), PAYLOAD).headers['Content-Type']).toBe('application/json');
    const custom = endpoint({ requestTemplate: TEMPLATE, publicHeaders: { 'content-type': 'text/plain' } });
    const headers = planOf(custom, PAYLOAD).headers;
    expect(headers['content-type']).toBe('text/plain');
    expect(Object.keys(headers).filter((header) => header.toLowerCase() === 'content-type')).toHaveLength(1);
  });

  it('une charge utile ou un corps trop lourd est refusé avant tout envoi', () => {
    const heavy = { text: 'A'.repeat(17_000) };
    expect(buildWebhookRequest(endpoint({ requestTemplate: '{{payload}}' }), heavy)).toMatchObject({ ok: false, summary: expect.stringContaining('Charge utile trop lourde') });
    const repeated = Array.from({ length: 5 }, () => '{{payload}}');
    expect(buildWebhookRequest(endpoint({ requestTemplate: repeated }), { text: 'B'.repeat(15_000) })).toMatchObject({ ok: false, summary: expect.stringContaining('Corps de la requête trop lourd') });
  });
});

describe('en-têtes et authentification', () => {
  it('sans authentification : les en-têtes publics, puis les secrets ; un secret l\u0027emporte, la casse du nom près', () => {
    const request = planOf(endpoint({ publicHeaders: { 'X-Token': 'public', Accept: 'application/json' }, secretHeaders: { 'x-token': SECRET_HEADER_VALUE, 'X-Secret': 'v' } }));
    expect(request.headers).toEqual({ Accept: 'application/json', 'x-token': SECRET_HEADER_VALUE, 'X-Secret': 'v' });
  });

  it('`bearer` : `Authorization: Bearer <identifiant>`, jamais deux fois « Bearer »', () => {
    expect(planOf(endpoint({ authType: 'bearer', secretHeaders: { Authorization: RAW_TOKEN } })).headers['Authorization']).toBe(`Bearer ${RAW_TOKEN}`);
    // Le nom de l'en-tête d'authentification est celui que déclare le connecteur (son défaut ici), la casse du nom stocké n'importe pas.
    expect(planOf(endpoint({ authType: 'bearer', secretHeaders: { authorization: SECRET_HEADER_VALUE } })).headers['Authorization']).toBe(SECRET_HEADER_VALUE);
    const named = planOf(endpoint({ authType: 'bearer', authHeaderName: 'X-Auth', secretHeaders: { 'X-Auth': RAW_TOKEN } }));
    expect(named.headers['X-Auth']).toBe(`Bearer ${RAW_TOKEN}`);
    expect(named.headers).not.toHaveProperty('Authorization');
  });

  it('`header` : l\u0027identifiant part tel quel, sous le nom déclaré (défaut `X-Api-Key`)', () => {
    expect(planOf(endpoint({ authType: 'header', secretHeaders: { 'X-Api-Key': RAW_TOKEN } })).headers['X-Api-Key']).toBe(RAW_TOKEN);
    expect(planOf(endpoint({ authType: 'header', authHeaderName: 'X-Token', secretHeaders: { 'X-Token': RAW_TOKEN } })).headers['X-Token']).toBe(RAW_TOKEN);
  });

  it('un type déclaré sans son en-tête secret est refusé : jamais d\u0027appel sans identifiant', () => {
    for (const authType of ['bearer', 'header'] as const) {
      const built = buildWebhookRequest(endpoint({ authType }), {});
      expect(built).toMatchObject({ ok: false, summary: expect.stringContaining('authentification « ' + authType + ' » déclarée') });
    }
    expect(buildWebhookRequest(endpoint({ authType: 'bearer', secretHeaders: { Authorization: '   ' } }), {})).toMatchObject({ ok: false });
    // L'identifiant est un secret : celui d'un en-tête public ne compte pas.
    const publicOnly = buildWebhookRequest(endpoint({ authType: 'bearer', publicHeaders: { Authorization: 'Bearer x' } }), {});
    expect(publicOnly).toMatchObject({ ok: false, summary: expect.stringContaining('« Authorization »') });
    expect(JSON.stringify(publicOnly)).not.toContain(RAW_TOKEN);
  });

  it('un en-tête non envoyable (ligne écrite hors du service) est refusé', () => {
    const built = buildWebhookRequest(endpoint({ publicHeaders: { 'X Bad': 'v' } }), {});
    expect(built).toMatchObject({ ok: false, summary: expect.stringContaining('nom d\u0027en-tête invalide') });
  });
});

describe('URL', () => {
  it('rendue normalisée ; une adresse refusée par la garde refuse la requête', () => {
    expect(planOf(endpoint({ url: `${URL}/` })).url).toBe(URL);
    expect(buildWebhookRequest(endpoint({ url: 'http://api.example.test/hook' }), {})).toMatchObject({ ok: false, summary: expect.stringContaining('URL du connecteur refusée') });
    expect(buildWebhookRequest(endpoint({ url: 'https://127.0.0.1/hook' }), {})).toMatchObject({ ok: false });
  });
});

describe('valueAtPath', () => {
  const source = { items: [{ id: 1 }], n: null };

  it('suit les objets et les tableaux ; chemin vide : la valeur elle-même', () => {
    expect(valueAtPath(source, 'items.0.id')).toBe(1);
    expect(valueAtPath(source, 'n')).toBeNull();
    expect(valueAtPath(source, 'items')).toEqual([{ id: 1 }]);
    expect(valueAtPath(source, '')).toBe(source);
  });

  it('chemin absent : undefined ; le prototype n\u0027est jamais parcouru', () => {
    expect(valueAtPath(source, 'items.5.id')).toBeUndefined();
    expect(valueAtPath(source, 'n.x')).toBeUndefined();
    expect(valueAtPath(source, 'constructor.name')).toBeUndefined();
    expect(valueAtPath(source, '__proto__.x')).toBeUndefined();
    expect(valueAtPath(source, 'toString.constructor')).toBeUndefined();
  });
});

describe('extractResponseValue', () => {
  const BODY = '{"data":{"result":"ok"},"list":[{"name":"a"}],"rien":null}';

  it('la valeur du chemin, ou null sans chemin, sans JSON ou sans valeur à ce chemin', () => {
    expect(extractResponseValue(BODY, 'data.result')).toEqual({ value: 'ok', truncated: false });
    expect(extractResponseValue(BODY, 'list.0.name')).toEqual({ value: 'a', truncated: false });
    expect(extractResponseValue(BODY, 'data')).toEqual({ value: { result: 'ok' }, truncated: false });
    expect(extractResponseValue(BODY, 'rien')).toEqual({ value: null, truncated: false });
    expect(extractResponseValue(BODY, null)).toEqual({ value: null, truncated: false });
    expect(extractResponseValue(BODY, 'data.missing')).toEqual({ value: null, truncated: false });
    expect(extractResponseValue('<html>Service indisponible</html>', 'data')).toEqual({ value: null, truncated: false });
    expect(extractResponseValue('', 'data')).toEqual({ value: null, truncated: false });
    expect(extractResponseValue('42', 'x')).toEqual({ value: null, truncated: false });
  });

  it('une valeur trop volumineuse rend un aperçu tronqué, jamais le bloc entier', () => {
    const json = JSON.stringify({ data: 'A'.repeat(EXTRACTED_MAX_CHARS + 500) });
    const extracted = extractResponseValue(json, 'data');
    expect(extracted.truncated).toBe(true);
    expect(JSON.stringify(extracted.value).length).toBeLessThan(EXTRACTED_MAX_CHARS);
    expect(extracted.value).toMatchObject({ truncated: true });
  });
});
