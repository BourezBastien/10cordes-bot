import type { ChatOptions } from '../../shared/llm/chat-contract';
import type { AbstractProviderAdapter } from '../providers/provider-adapter';
import type { CapabilityRouterService } from '../providers/capability-router.service';
import { buildProviderUrl, providerHeaders } from '../providers/provider-http';
import { chatCompletionsPath } from '../providers/provider-protocols';
import type { ResolvedRoute } from '../providers/provider-store.service';
import type { ProviderConfig, ProviderProtocol } from '../providers/provider.types';

export const NOT_CONFIGURED_MESSAGE = 'Le module IA n\u0027est pas configuré (aucune clé API).';

/** Configuration d'instance (modale owner ou env) : le secours d'un serveur sans route de conversation. */
export interface LegacyChatConfig {
  baseUrl: string | null;
  apiKey: string | undefined;
  model: string;
}

/** Où et comment envoyer un tour de conversation. */
export interface ChatEndpoint {
  /** Hôte du fournisseur : identifie un refus de `reasoning_effort`. */
  host: string;
  protocol: ProviderProtocol;
  model: string;
  url: string;
  /** En-têtes HTTP, authentification comprise. Jamais journalisés ni renvoyés. */
  headers: Record<string, string>;
  /** Route du serveur ; null pour la configuration d'instance. */
  route: ResolvedRoute | null;
  /** Tentative en cours sur la route : fournisseur (clé déchiffrée) et adaptateur de son protocole. */
  attempt: { provider: ProviderConfig; adapter: AbstractProviderAdapter } | null;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Où envoyer un tour de conversation : la route de la capacité sur le
 * serveur (moteur multi-fournisseurs), sinon la configuration d'instance.
 * Aucun appel réseau : la clé n'est lue que pour construire les en-têtes.
 */
export class ChatEndpointPlanner {
  constructor(private readonly deps: { router: Pick<CapabilityRouterService, 'chatEndpoint'>; legacy: () => LegacyChatConfig }) {}

  async plan(options: ChatOptions, preferReasoning: boolean): Promise<ChatEndpoint> {
    const route = await this.deps.router.chatEndpoint(options.guildId, options.cause, preferReasoning);
    return route ? this.forProvider(route.provider, route.modelId, route) : this.instance();
  }

  /** Endpoint d'une tentative d'une route : fournisseur principal ou de repli. */
  forProvider(provider: ProviderConfig, modelId: string, route: ResolvedRoute | null, adapter?: AbstractProviderAdapter): ChatEndpoint {
    return {
      host: new URL(provider.baseUrl).host,
      protocol: provider.protocol,
      model: modelId,
      url: buildProviderUrl(provider, chatCompletionsPath(provider.protocol)).toString(),
      headers: providerHeaders(provider, JSON_HEADERS),
      route,
      attempt: adapter ? { provider, adapter } : null,
    };
  }

  private instance(): ChatEndpoint {
    const legacy = this.deps.legacy();
    if (!legacy.baseUrl || !legacy.apiKey) throw new Error(NOT_CONFIGURED_MESSAGE);
    const baseUrl = legacy.baseUrl.replace(/\/+$/u, '');
    return {
      host: new URL(baseUrl).host,
      protocol: 'openai-chat',
      model: legacy.model,
      url: `${baseUrl}/chat/completions`,
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${legacy.apiKey}` },
      route: null,
      attempt: null,
    };
  }
}
