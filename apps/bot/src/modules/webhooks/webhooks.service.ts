import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { AuditService } from '../audit/audit.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { WebhookEndpointService } from './webhook-endpoint.service';
import { buildWebhooksTools } from './webhooks.tools';

/**
 * Connecteurs HTTP sortants : enregistre l'outil `webhook.call` au registry au
 * démarrage. La logique vit dans WebhookEndpointService (lignes, chiffrement,
 * exécution) ; ce provider n'en porte pas.
 */
@Injectable()
export class WebhooksService implements SpraxiumOnBoot {
  private readonly log = new Logger('WebhooksBoot');

  constructor(
    private readonly endpoints: WebhookEndpointService,
    private readonly audit: AuditService,
  ) {}

  onBoot(): void {
    const registry = getToolRegistry();
    const tools = buildWebhooksTools({ endpoints: this.endpoints, audit: this.audit });
    for (const tool of tools) registry.register(tool);
    this.log.info(`${tools.length} tool webhooks enregistré.`);
  }
}
