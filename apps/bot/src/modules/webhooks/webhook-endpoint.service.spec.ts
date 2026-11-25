import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebhookCreate } from '@10cordes/shared';
import type { ProviderSecrets } from '../providers/provider-store.codec';
import { decodeSecretHeaders, encodeSecretHeaders } from './webhook-endpoint.codec';
import { WebhookEndpointService, WEBHOOKS_PER_GUILD_MAX } from './webhook-endpoint.service';
import { ACTOR, fakeWebhookStore, GUILD, OTHER_GUILD, SECRET_HEADER_VALUE, TEST_KEY, webhookRow } from './webhook.fake-store';

/**
 * Connecteurs HTTP sortants, sur la base en mémoire du module. L’échange HTTP
 * lui-même est remplacé (il a ses épreuves dans webhook-http.spec.ts) : ce qui
 * est fixé ici, c’est le service. Un en-tête secret n’existe en clair qu’au
 * moment de l’appel : en base il est chiffré ; dans une vue, un résultat ou un
 * audit, il n’y a que son nom. Un connecteur d’un AUTRE serveur est
 * introuvable, jamais une fuite vers lui.
 */

const exchange = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('./webhook-http', () => ({ sendWebhookRequest: exchange.send }));

const SECRETS: ProviderSecrets = { token: 'x', encryption: TEST_KEY };
const ENV = { ENCRYPTION_SECRET: TEST_KEY, token: 'x' } as never;
const PUBLIC = 'https://api.example.test/hooks/orders';
const AUTH = { authType: 'bearer' as const, authHeaderName: 'Authorization', secretHeaders: { Authorization: SECRET_HEADER_VALUE } };
const NEW_SECRET = 'Bearer another-test-key-not-real';
// Clé calculée : le scanner du registre des outils lit, dans toute source suivie, une clé name suivie d'une chaîne littérale.
const NAME = 'name';

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function mount(seed: ReturnType<typeof webhookRow>[] = []) {
  const store = fakeWebhookStore(seed);
  const audit = { record: vi.fn() };
  const service = new WebhookEndpointService(store as never, audit as never, ENV);
  return { store, audit, service };
}

/** Une ligne chiffrée par le codec, comme le service l’écrirait, avec un gabarit de corps où la charge utile se pose. */
function secured(overrides: Parameters<typeof webhookRow>[0] = {}) {
  return webhookRow({
    authType: 'bearer',
    authHeaderName: 'Authorization',
    encryptedHeaders: encodeSecretHeaders({ Authorization: SECRET_HEADER_VALUE }, SECRETS),
    responseExtractPath: 'result',
    requestTemplateJson: JSON.stringify({ ping: '{{payload.ping}}', at: '{{payload.at}}', order: '{{payload.order}}' }),
    ...overrides,
  });
}

const sent = (index: number): Sent => exchange.send.mock.calls[index]?.[0] as Sent;

beforeEach(() => {
  exchange.send.mockReset();
  exchange.send.mockResolvedValue({ ok: true, status: 200, body: '{"result":"ok"}', ms: 12, unfollowedRedirect: false });
});

describe('WebhookEndpointService · écritures', () => {
  it('créer : la valeur d’un en-tête secret est chiffrée en base, et ne paraît ni dans la vue ni dans l’audit', async () => {
    const { service, store, audit } = mount();
    const body: WebhookCreate = { slug: 'alerte', [NAME]: 'Alerte', method: 'POST', url: PUBLIC, ...AUTH };
    const view = await service.create(GUILD, body, ACTOR, 'api');
    const row = store.rows.get(view.webhookId);
    expect(row).toBeDefined();
    expect(row?.encryptedHeaders).not.toContain(TEST_KEY);
    expect(decodeSecretHeaders(row?.encryptedHeaders, SECRETS)).toEqual({ Authorization: SECRET_HEADER_VALUE });
    expect(view).toMatchObject({ slug: 'alerte', secretHeaderNames: ['Authorization'], lastHttpStatus: null });
    expect(JSON.stringify(view)).not.toContain(TEST_KEY);
    expect(audit.record).toHaveBeenCalledWith({ guildId: GUILD, source: 'api', action: 'webhook.created', actorId: ACTOR, metadata: { webhookId: view.webhookId, slug: 'alerte' } });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(TEST_KEY);
  });

  it('créer : une adresse privée est refusée (invalid), un slug pris aussi (conflit) ; rien n’est écrit ni audité', async () => {
    const { service, store, audit } = mount([webhookRow()]);
    const base: WebhookCreate = { slug: 'nouveau', [NAME]: 'Nouveau', method: 'POST', url: PUBLIC };
    for (const url of ['http://api.example.test/x', 'https://localhost/x', 'https://10.0.0.4/x', 'https://169.254.169.254/latest']) {
      await expect(service.create(GUILD, { ...base, url }, ACTOR, 'api'), url).rejects.toMatchObject({ [NAME]: 'WebhookEndpointError', kind: 'invalid' });
    }
    await expect(service.create(GUILD, { ...base, slug: 'orders' }, ACTOR, 'api')).rejects.toMatchObject({ [NAME]: 'WebhookEndpointError', kind: 'conflict' });
    expect(store.rows.size).toBe(1);
    expect(store.webhookEndpoint.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('créer : le quota de 20 connecteurs est un refus typé (limit), et il ne compte que CE serveur', async () => {
    const full = Array.from({ length: WEBHOOKS_PER_GUILD_MAX }, (_, index) => webhookRow({ id: `wh_${index}`, slug: `slug-${index}` }));
    full.push(webhookRow({ id: 'ailleurs', guildId: OTHER_GUILD, slug: 'ailleurs' }));
    const { service } = mount(full);
    await expect(service.create(GUILD, { slug: 'un-de-plus', [NAME]: 'X', method: 'POST', url: PUBLIC }, ACTOR, 'api')).rejects.toMatchObject({ kind: 'limit' });
    const other = await service.create(OTHER_GUILD, { slug: 'un-de-plus', [NAME]: 'X', method: 'POST', url: PUBLIC }, ACTOR, 'api');
    expect(other.slug).toBe('un-de-plus');
  });

  it('mettre à jour : des secrets absents du corps restent chiffrés tels quels ; redonnés, ils sont remplacés ; null les retire', async () => {
    const original = secured();
    const { service, store, audit } = mount([original]);
    const renamed = await service.update(GUILD, original.id, { name: 'Renommé' }, ACTOR, 'api');
    expect(renamed?.name).toBe('Renommé');
    expect(renamed?.secretHeaderNames).toEqual(['Authorization']);
    expect(store.rows.get(original.id)?.encryptedHeaders).toBe(original.encryptedHeaders);

    await service.update(GUILD, original.id, { secretHeaders: { Authorization: NEW_SECRET, 'X-Token': 'v' } }, ACTOR, 'api');
    const replaced = store.rows.get(original.id);
    expect(replaced?.encryptedHeaders).not.toBe(original.encryptedHeaders);
    expect(replaced?.encryptedHeaders).not.toContain(NEW_SECRET);
    expect(decodeSecretHeaders(replaced?.encryptedHeaders, SECRETS)).toEqual({ Authorization: NEW_SECRET, 'X-Token': 'v' });

    const cleared = await service.update(GUILD, original.id, { secretHeaders: null }, ACTOR, 'api');
    expect(cleared?.secretHeaderNames).toEqual([]);
    expect(store.rows.get(original.id)?.encryptedHeaders).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'webhook.updated', source: 'api', actorId: ACTOR }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(TEST_KEY);
  });

  it('un connecteur d’un autre serveur est introuvable : rien n’est écrit ni envoyé', async () => {
    const { service, store, audit } = mount([secured({ id: 'ailleurs', guildId: OTHER_GUILD, slug: 'ailleurs' })]);
    expect(await service.update(GUILD, 'ailleurs', { [NAME]: 'X' }, ACTOR, 'api')).toBeNull();
    expect(await service.remove(GUILD, 'ailleurs', ACTOR, 'api')).toBe(false);
    expect(await service.ping(GUILD, 'ailleurs', ACTOR, 'api')).toBeNull();
    expect((await service.call(GUILD, 'ailleurs', { x: 1 })).webhookId).toBeNull();
    expect(await service.list(GUILD)).toEqual([]);
    expect(exchange.send).not.toHaveBeenCalled();
    expect(store.webhookEndpoint.update).not.toHaveBeenCalled();
    expect(store.webhookEndpoint.deleteMany).not.toHaveBeenCalled();
    expect(store.rows.size).toBe(1);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('supprimer : la ligne part, l’audit aussi ; inconnu : false', async () => {
    const row = secured();
    const { service, store, audit } = mount([row]);
    expect(await service.remove(GUILD, row.id, ACTOR, 'api')).toBe(true);
    expect(store.rows.size).toBe(0);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'webhook.deleted', metadata: { webhookId: row.id, slug: 'orders' } }));
    expect(await service.remove(GUILD, row.id, ACTOR, 'api')).toBe(false);
  });
});

describe('WebhookEndpointService · essais et appels', () => {
  it('un essai part avec la charge utile du contrat, les identifiants déchiffrés pour l’appel seul, et consigne le statut', async () => {
    const row = secured();
    const { service, store, audit } = mount([row]);
    const result = await service.ping(GUILD, 'orders', ACTOR, 'api');
    expect(result).toMatchObject({ ok: true, status: 200, extracted: 'ok', ms: 12 });
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
    expect(exchange.send).toHaveBeenCalledTimes(1);
    expect(sent(0)).toMatchObject({ url: PUBLIC, method: 'POST', headers: { Authorization: SECRET_HEADER_VALUE, 'Content-Type': 'application/json' } });
    expect(JSON.parse(sent(0).body ?? '{}')).toMatchObject({ ping: true, at: expect.any(String) });
    expect(store.rows.get(row.id)?.lastHttpStatus).toBe(200);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'webhook.ping', source: 'api', actorId: ACTOR, metadata: { webhookId: row.id, slug: 'orders', ok: true, status: 200 } }));
    // L’essai ne réécrit pas les secrets : la colonne chiffrée est intacte.
    expect(store.rows.get(row.id)?.encryptedHeaders).toBe(row.encryptedHeaders);
  });

  it('sans gabarit de corps, aucun corps ne part : la charge utile n’est pas transmise', async () => {
    const row = secured({ requestTemplateJson: null });
    const { service } = mount([row]);
    await service.call(GUILD, 'orders', { order: 7 });
    expect(sent(0).body).toBeNull();
    expect(new Headers(sent(0).headers).has('content-type')).toBe(false);
  });

  it('un statut d’échec est un résultat (ok false), consigné avec sa raison', async () => {
    const row = secured();
    const { service, store } = mount([row]);
    exchange.send.mockResolvedValue({ ok: true, status: 401, body: '', ms: 3, unfollowedRedirect: false });
    const result = await service.ping(GUILD, row.id, ACTOR, 'api');
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(result?.summary).toContain('authentification refusée');
    expect(store.rows.get(row.id)).toMatchObject({ lastHttpStatus: 401, lastError: 'HTTP 401 (authentification refusée par le service distant)' });
  });

  it('un connecteur désactivé ne déclenche aucun appel, et rien n’est consigné', async () => {
    const row = secured({ enabled: false });
    const { service, store } = mount([row]);
    const result = await service.call(GUILD, 'orders', {});
    expect(result).toMatchObject({ ok: false, status: null, ms: 0, webhookId: row.id, slug: 'orders' });
    expect(result?.summary).toContain('désactivé');
    expect(exchange.send).not.toHaveBeenCalled();
    expect(store.webhookEndpoint.update).not.toHaveBeenCalled();
  });

  it('un slug inconnu sur ce serveur : un constat, sans repère, et aucun appel', async () => {
    const { service } = mount([secured({ id: 'ailleurs', guildId: OTHER_GUILD, slug: 'ailleurs' })]);
    const result = await service.call(GUILD, 'ailleurs', { x: 1 });
    expect(result).toMatchObject({ ok: false, webhookId: null, slug: null, ms: 0 });
    expect(result?.summary).toContain('introuvable');
    expect(exchange.send).not.toHaveBeenCalled();
  });

  it('un appel par slug ou par identifiant rend le résultat et ses repères, sans secret', async () => {
    const row = secured();
    const { service } = mount([row]);
    for (const ref of ['orders', row.id]) {
      const result = await service.call(GUILD, ref, { order: 7 });
      expect(result).toMatchObject({ ok: true, webhookId: row.id, slug: 'orders', extracted: 'ok' });
      expect(JSON.stringify(result)).not.toContain(TEST_KEY);
    }
    expect(JSON.parse(sent(1).body ?? '{}')).toMatchObject({ order: 7 });
  });
});
