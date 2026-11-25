import { describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '@10cordes/shared';
import type { WebhookCallResult } from './webhook-endpoint.service';
import { WebhooksService } from './webhooks.service';
import { buildWebhooksTools } from './webhooks.tools';

/**
 * L’outil `webhook.call` et son enregistrement au démarrage. Le modèle donne
 * un slug et une charge utile : il ne choisit ni l’adresse ni les en-têtes.
 * L’appel est toujours borné au serveur de la demande, audité avec l’acteur,
 * et la charge utile ne part pas dans l’audit.
 */

const GUILD = '1550000000000000001';
const USER = '1550000000000000003';

const registry = vi.hoisted(() => ({ register: vi.fn() }));

vi.mock('../tool-registry/tool-registry.service', () => ({ getToolRegistry: () => registry }));

const CALL: WebhookCallResult = { ok: true, status: 200, summary: 'Connecteur « orders » : HTTP 200 en 12 ms.', extracted: { id: 7 }, ms: 12, webhookId: 'wh_1', slug: 'orders' };

function mount() {
  const endpoints = { call: vi.fn(async (): Promise<WebhookCallResult> => CALL) };
  const audit = { record: vi.fn() };
  const [tool, ...others] = buildWebhooksTools({ endpoints: endpoints as never, audit: audit as never });
  return { tool: tool!, others, endpoints, audit };
}

const context = (overrides: Partial<ToolRunContext> = {}): ToolRunContext => ({ guildId: GUILD, userId: USER, ...overrides } as ToolRunContext);

describe('webhook.call', () => {
  it('un seul outil, nommé webhook.call, qui modifie (write) sans être destructif', () => {
    const { tool, others } = mount();
    expect(others).toEqual([]);
    expect(tool).toMatchObject({ name: 'webhook.call', category: 'webhooks', destructive: false, requiredModules: [], permissions: [] });
  });

  it('hors d’un serveur : refusé, et rien n’est appelé', async () => {
    const { tool, endpoints, audit } = mount();
    const result = await tool.handler({ webhook: 'orders' }, context({ guildId: null }));
    expect(result).toEqual({ ok: false, summary: 'Contexte de serveur requis.' });
    expect(endpoints.call).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('appelle le connecteur du SERVEUR de la demande avec la charge utile, audite l’appel sans elle, et rend statut et valeur extraite', async () => {
    const { tool, endpoints, audit } = mount();
    const payload = { order: 7, note: 'confidentielle' };
    const result = await tool.handler({ webhook: 'orders', payload }, context());
    expect(endpoints.call).toHaveBeenCalledWith(GUILD, 'orders', payload);
    expect(result).toEqual({ ok: true, summary: CALL.summary, data: { status: 200, extracted: { id: 7 } } });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith({ guildId: GUILD, source: 'agent', action: 'webhook.called', actorId: USER, metadata: { webhookId: 'wh_1', slug: 'orders', ok: true, status: 200 } });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('confidentielle');
  });

  it('sans charge utile : un objet vide ; un connecteur inconnu : le constat, sans audit', async () => {
    const { tool, endpoints, audit } = mount();
    await tool.handler({ webhook: 'orders' }, context());
    expect(endpoints.call).toHaveBeenLastCalledWith(GUILD, 'orders', {});
    const notFound: WebhookCallResult = { ok: false, status: null, summary: 'Connecteur « x » introuvable sur ce serveur.', extracted: null, ms: 0, webhookId: null, slug: null };
    endpoints.call.mockResolvedValueOnce(notFound);
    const result = await tool.handler({ webhook: 'x' }, context());
    expect(result.ok).toBe(false);
    expect(result.data).toEqual({ status: null, extracted: null });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('les paramètres sont validés : le slug est borné et nettoyé, la charge utile est un objet', () => {
    const { tool } = mount();
    const schema = tool.paramsSchema;
    expect(schema.safeParse({ webhook: '  orders  ' }).data).toEqual({ webhook: 'orders' });
    expect(schema.safeParse({ webhook: '' }).success).toBe(false);
    expect(schema.safeParse({ webhook: 'x'.repeat(61) }).success).toBe(false);
    expect(schema.safeParse({ webhook: 'orders', payload: 'texte' }).success).toBe(false);
  });
});

describe('WebhooksService', () => {
  it('au démarrage, enregistre l’outil webhook.call au registre des outils', () => {
    registry.register.mockReset();
    new WebhooksService({} as never, {} as never).onBoot();
    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(registry.register.mock.calls[0]?.[0]).toMatchObject({ name: 'webhook.call' });
  });
});
