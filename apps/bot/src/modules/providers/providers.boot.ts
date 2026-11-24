import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client } from 'discord.js';
import { ConfigThreadService } from '../guild-config/config-thread.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { AnthropicMessagesAdapter } from './adapters/anthropic-messages.adapter';
import { GenericHttpAdapter } from './adapters/generic-http.adapter';
import { KieUnifiedAdapter } from './adapters/kie-unified.adapter';
import { OpenAiCompatibleAdapter } from './adapters/openai-compatible.adapter';
import { ProviderAdapterRegistry } from './provider-adapter.registry';
import { buildCapabilityTools } from './capability.tools';
import { CapabilityRouterService } from './capability-router.service';
import { buildHubTool } from './hub.tool';
import { buildProviderTools } from './provider.tools';
import { GuildProviderService } from './provider-store.service';
import { bindProvidersRuntime } from './providers.runtime';

/**
 * Démarrage du moteur multi-fournisseurs. C'est un PROVIDER (avec `onBoot`),
 * pas le module : le framework n'instancie jamais les classes de module.
 * Enregistre les adaptateurs de protocole, puis les tools en langage naturel
 * (`provider.*`, `capability.*`, `providers.panel`). L'alignement des copies
 * de la configuration d'instance a lieu au démarrage de LlmService, qui se
 * charge après IntegrationModule.
 */
@Injectable()
export class ProvidersBoot implements SpraxiumOnBoot {
  private readonly log = new Logger('Providers');

  constructor(
    private readonly adapters: ProviderAdapterRegistry,
    private readonly store: GuildProviderService,
    private readonly router: CapabilityRouterService,
    private readonly tools: ToolRegistryService,
    private readonly client: Client,
    private readonly configThread: ConfigThreadService,
  ) {}

  async onBoot(): Promise<void> {
    for (const adapter of [new OpenAiCompatibleAdapter(), new AnthropicMessagesAdapter(), new KieUnifiedAdapter(), new GenericHttpAdapter()]) {
      this.adapters.register(adapter);
    }
    const hubDeps = { store: this.store, registry: this.adapters };
    for (const tool of [
      ...buildProviderTools(hubDeps),
      ...buildCapabilityTools({ store: this.store }),
      buildHubTool({ ...hubDeps, client: this.client, configThread: this.configThread }),
    ]) {
      this.tools.register(tool);
    }
    bindProvidersRuntime({ store: this.store, router: this.router });
    this.log.info(`Providers ready (${this.adapters.protocols().length} protocoles : ${this.adapters.protocols().join(', ')}).`);
  }
}
