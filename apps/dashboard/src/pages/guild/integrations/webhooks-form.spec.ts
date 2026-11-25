import { describe, expect, it } from 'vitest';
import {
  buildWebhookCreate,
  buildWebhookUpdate,
  EMPTY_FORM,
  formOf,
  parseStringRecord,
  secretHeadersOf,
  validateWebhook,
  type WebhookForm,
} from '@/pages/guild/integrations/webhooks-form';
import { webhookView } from '@/test/fixtures';

/*
 * Formulaire d'un connecteur : le jeton devient un en-tête secret, un
 * secret vide est conservé en édition, et l'URL doit être https publique.
 */

const SECRET = 'test-key-not-real';
const TOKEN_HEADER = 'X-Api-Key';
const MESSAGES = { name: 'NOM', slug: 'SLUG', url: 'URL', header: 'ENTETE', json: 'JSON', path: 'CHEMIN' };

function form(overrides: Partial<WebhookForm> = {}): WebhookForm {
  return {
    ...EMPTY_FORM,
    name: 'Alerte',
    slug: 'alerte',
    url: 'https://hooks.exemple.com/v1',
    ...overrides,
  };
}

describe('parseStringRecord', () => {
  it('rend null pour un champ vide, et l’objet pour un objet de chaînes', () => {
    expect(parseStringRecord('  ')).toEqual({ ok: true, value: null });
    expect(parseStringRecord('{"X-Org": "a"}')).toEqual({ ok: true, value: { 'X-Org': 'a' } });
  });

  it('refuse un JSON illisible, un non-objet et une valeur qui n’est pas une chaîne', () => {
    expect(parseStringRecord('{oops')).toEqual({ ok: false });
    expect(parseStringRecord('[1]')).toEqual({ ok: false });
    expect(parseStringRecord('{"X": 3}')).toEqual({ ok: false });
  });
});

describe('validateWebhook', () => {
  it('accepte une saisie complète', () => {
    expect(validateWebhook(form(), false, MESSAGES)).toEqual({});
  });

  it('refuse une adresse http, et une adresse https privée ou locale', () => {
    expect(validateWebhook(form({ url: 'http://hooks.exemple.com' }), false, MESSAGES).url).toBe('URL');
    for (const url of ['https://localhost/hook', 'https://127.0.0.1/hook', 'https://10.0.0.4/hook', 'https://169.254.169.254/latest', 'https://[::1]/']) {
      expect(validateWebhook(form({ url }), false, MESSAGES).url, url).toBe('URL');
    }
  });

  it('signale le nom, le slug, l’en-tête, le chemin et les champs JSON', () => {
    const errors = validateWebhook(
      form({ name: ' ', slug: 'Pas Bon', authType: 'header', authHeaderName: 'Xés', responseExtractPath: 'data/result', publicHeaders: '{', secretHeaders: '3', requestTemplate: '[' }),
      false,
      MESSAGES,
    );
    expect(errors).toEqual({
      name: 'NOM',
      slug: 'SLUG',
      authHeaderName: 'ENTETE',
      responseExtractPath: 'CHEMIN',
      publicHeaders: 'JSON',
      secretHeaders: 'JSON',
      requestTemplate: 'JSON',
    });
  });

  it('en édition, le slug et la méthode ne se contrôlent plus', () => {
    expect(validateWebhook(form({ slug: '', method: 'GET' }), true, MESSAGES)).toEqual({});
  });
});

describe('secretHeadersOf', () => {
  it('rend null sans rien de saisi', () => {
    expect(secretHeadersOf(form())).toEqual({ ok: true, value: null });
  });

  it('un jeton bearer devient un en-tête Authorization', () => {
    expect(secretHeadersOf(form({ token: SECRET }))).toEqual({
      ok: true,
      value: { Authorization: `Bearer ${SECRET}` },
    });
  });

  it('un jeton de type « header » prend le nom de l’en-tête saisi', () => {
    expect(secretHeadersOf(form({ authType: 'header', authHeaderName: TOKEN_HEADER, token: SECRET }))).toEqual({
      ok: true,
      value: { [TOKEN_HEADER]: SECRET },
    });
  });

  it('s’ajoute aux en-têtes secrets du champ JSON, et signale les siens illisibles', () => {
    expect(secretHeadersOf(form({ token: SECRET, secretHeaders: '{"X-Token": "v"}' }))).toEqual({
      ok: true,
      value: { 'X-Token': 'v', Authorization: `Bearer ${SECRET}` },
    });
    expect(secretHeadersOf(form({ secretHeaders: 'x' }))).toEqual({ ok: false });
  });
});

describe('buildWebhookCreate', () => {
  it('porte les champs saisis, sans secrets ni options vides', () => {
    const body = buildWebhookCreate(form());
    expect(body).toEqual({
      slug: 'alerte',
      name: 'Alerte',
      method: 'POST',
      url: 'https://hooks.exemple.com/v1',
      authType: 'bearer',
      enabled: true,
    });
    expect('secretHeaders' in body).toBe(false);
  });

  it('emporte le jeton, les en-têtes, le gabarit et le chemin', () => {
    const body = buildWebhookCreate(
      form({ token: SECRET, publicHeaders: '{"X-Org": "a"}', requestTemplate: '{"text": "x"}', responseExtractPath: 'data.result' }),
    );
    expect(body.secretHeaders).toEqual({ Authorization: `Bearer ${SECRET}` });
    expect(body.publicHeaders).toEqual({ 'X-Org': 'a' });
    expect(body.requestTemplate).toEqual({ text: 'x' });
    expect(body.responseExtractPath).toBe('data.result');
  });
});

describe('buildWebhookUpdate', () => {
  it('rien d’envoyé si rien ne change', () => {
    expect(buildWebhookUpdate(webhookView, formOf(webhookView))).toEqual({});
  });

  it('un jeton et des secrets vides conservent ceux d’avant : absents du corps', () => {
    const body = buildWebhookUpdate(webhookView, { ...formOf(webhookView), name: 'Nouveau nom' });
    expect('secretHeaders' in body).toBe(false);
    expect('requestTemplate' in body).toBe(false);
    expect(body).toEqual({ name: 'Nouveau nom' });
  });

  it('un jeton saisi remplace les en-têtes secrets', () => {
    const body = buildWebhookUpdate(webhookView, { ...formOf(webhookView), token: SECRET });
    expect(body.secretHeaders).toEqual({ Authorization: `Bearer ${SECRET}` });
  });

  it('un gabarit vidé retire le corps de la requête', () => {
    expect(buildWebhookUpdate(webhookView, { ...formOf(webhookView), requestTemplate: '' }).requestTemplate).toBeNull();
  });
});
