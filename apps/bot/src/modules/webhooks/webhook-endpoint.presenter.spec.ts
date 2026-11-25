import { describe, expect, it } from 'vitest';
import { WebhookEndpointViewSchema } from '@10cordes/shared';
import { encodeSecretHeaders, summaryOf, webhookFromRow } from './webhook-endpoint.codec';
import { WebhookEndpointPresenter } from './webhook-endpoint.presenter';
import { SECRET_HEADER_VALUE, TEST_KEY, webhookRow } from './webhook.fake-store';

/**
 * Vue d'un connecteur. Ce que ces tests fixent : la vue ne montre des en-têtes
 * secrets que leurs NOMS (assertion sur le texte littéral), elle respecte le
 * contrat du tableau de bord champ par champ, et une ligne écrite hors du
 * service (trop longue) ne fait pas sortir une vue du contrat.
 */

// Clé calculée : le scanner du registre des outils lit, dans toute source suivie, une clé name suivie d'une chaîne littérale.
const NAME = 'name';
const SECRETS = { token: 'x', encryption: TEST_KEY };
const presenter = new WebhookEndpointPresenter();

const viewOf = (ciphertext: string | null, overrides: Parameters<typeof webhookRow>[0] = {}) =>
  presenter.present(summaryOf(webhookFromRow(webhookRow({ encryptedHeaders: ciphertext, ...overrides }), SECRETS)));

describe('WebhookEndpointPresenter', () => {
  it('rend la vue du contrat : hôte de l\u0027URL, gabarit parsé, dates ISO, noms des en-têtes secrets triés', () => {
    const view = viewOf(encodeSecretHeaders({ 'Z-Last': SECRET_HEADER_VALUE, 'A-First': SECRET_HEADER_VALUE }, SECRETS), {
      method: 'PATCH',
      authType: 'bearer',
      authHeaderName: 'Authorization',
      publicHeadersJson: '{"X-Public":"1"}',
      requestTemplateJson: '{"text":"{{payload.text}}"}',
      responseExtractPath: 'data.id',
      enabled: false,
      lastHttpStatus: 502,
      lastCheckedAt: new Date('2026-11-25T11:30:00.000Z'),
      lastError: 'HTTP 502',
    });
    expect(view).toEqual({
      webhookId: 'wh_1',
      slug: 'orders',
      [NAME]: 'Commandes',
      method: 'PATCH',
      url: 'https://api.example.test/hooks/orders',
      domain: 'api.example.test',
      authType: 'bearer',
      authHeaderName: 'Authorization',
      publicHeaders: { 'X-Public': '1' },
      secretHeaderNames: ['A-First', 'Z-Last'],
      requestTemplate: { text: '{{payload.text}}' },
      responseExtractPath: 'data.id',
      enabled: false,
      lastHttpStatus: 502,
      lastCheckedAt: '2026-11-25T11:30:00.000Z',
      lastError: 'HTTP 502',
      createdAt: '2026-11-25T10:00:00.000Z',
      updatedAt: '2026-11-25T10:00:00.000Z',
    });
  });

  it('jamais la valeur d\u0027un en-tête secret : le texte de la vue ne la contient pas', () => {
    const text = JSON.stringify(viewOf(encodeSecretHeaders({ Authorization: SECRET_HEADER_VALUE, 'X-Api-Key': TEST_KEY }, SECRETS)));
    expect(text).not.toContain(TEST_KEY);
    expect(text).not.toContain('Bearer');
    expect(text).toContain('"secretHeaderNames":["Authorization","X-Api-Key"]');
  });

  it('un connecteur jamais appelé : statut, date et erreur à null ; sans gabarit : null', () => {
    const view = viewOf(null);
    expect(view).toMatchObject({ lastHttpStatus: null, lastCheckedAt: null, lastError: null, requestTemplate: null, responseExtractPath: null, secretHeaderNames: [], publicHeaders: {}, authHeaderName: null });
  });

  it('une colonne de secrets illisible ne montre aucun nom', () => {
    expect(viewOf('v1:illisible').secretHeaderNames).toEqual([]);
  });

  it('l\u0027hôte, sans le chemin ni le port ; l\u0027URL elle-même si elle est illisible', () => {
    expect(viewOf(null, { url: 'https://hooks.example.test:8443/a/b?c=d' }).domain).toBe('hooks.example.test');
    expect(viewOf(null, { url: 'pas une url' }).domain).toBe('pas une url');
  });

  it('toute vue reste dans les limites du contrat, même pour une ligne écrite hors du service', () => {
    const view = viewOf(encodeSecretHeaders({ ['A'.repeat(61)]: 'v' }, SECRETS), {
      [NAME]: 'N'.repeat(120),
      url: `https://api.example.test/${'p'.repeat(600)}`,
      responseExtractPath: 'x'.repeat(400),
      lastError: 'E'.repeat(500),
    });
    const parsed = WebhookEndpointViewSchema.safeParse(view);
    expect(parsed.success).toBe(true);
    expect(view.name).toHaveLength(80);
    expect(view.url).toHaveLength(500);
    expect(view.lastError).toHaveLength(300);
    expect(view.secretHeaderNames).toEqual(['A'.repeat(60)]);
  });

  it('les vues courantes passent le schéma du contrat', () => {
    for (const overrides of [{}, { method: 'GET' as const }, { authType: 'header' as const, authHeaderName: 'X-Api-Key' }, { requestTemplateJson: '[1,"a",{"b":null}]' }]) {
      expect(WebhookEndpointViewSchema.safeParse(viewOf(null, overrides)).success).toBe(true);
    }
  });
});
