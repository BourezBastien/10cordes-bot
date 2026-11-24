import { Injectable } from '@spraxium/common';
import type { ChatCause } from '../../shared/llm/chat-contract';
import { AuditService } from '../audit/audit.service';
import type { AbstractProviderAdapter } from './provider-adapter';
import { ProviderAdapterRegistry } from './provider-adapter.registry';
import { ProviderLegacyMigration } from './provider-legacy.migration';
import type { ResolvedRoute } from './provider-store.service';
import { GuildProviderService } from './provider-store.service';
import { ProviderError, isFallbackEligible, type Capability, type CapabilityCredentials, type ChatResult, type ChatTurnInput, type ProviderConfig, type ProviderExecutionResult, type ProviderRequest } from './provider.types';

/** Une tentative d'exécution d'une route : un fournisseur, son modèle et l'adaptateur de son protocole. */
export interface RouteAttempt {
  provider: ProviderConfig;
  modelId: string;
  adapter: AbstractProviderAdapter;
}

/**
 * Route une capacité du bot vers le modèle qui l'exécute sur un serveur, avec
 * bascule automatique sur le fournisseur de repli quand le fournisseur
 * principal est limité (429), indisponible (5xx) ou trop lent.
 */
@Injectable()
export class CapabilityRouterService {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
    private readonly audit: AuditService,
    private readonly legacy: ProviderLegacyMigration,
  ) {}

  /** Route ACTIVE d'une capacité pour ce serveur, null s'il n'y en a pas. */
  async resolve(guildId: string, capability: Capability): Promise<ResolvedRoute | null> {
    await this.legacy.ensureMigrated(guildId);
    const route = (await this.store.routes(guildId)).find((candidate) => candidate.capability === capability);
    return route && route.provider.enabled ? route : null;
  }

  /**
   * Tentatives d'une route, dans l'ordre : le fournisseur principal, puis son
   * repli s'il est actif et capable de servir la capacité. Le client LLM
   * boucle lui-même dessus quand il streame (il doit reprendre la main avant
   * tout delta publié).
   */
  attemptsOf(route: ResolvedRoute): RouteAttempt[] {
    const candidates = [{ provider: route.provider, modelId: route.modelId }, ...(route.fallback && route.fallback.provider.enabled ? [route.fallback] : [])];
    return candidates.flatMap((candidate) => {
      const adapter = this.registry.resolve(candidate.provider.protocol);
      return adapter.supports(route.capability, candidate.provider) ? [{ ...candidate, adapter }] : [];
    });
  }

  /** Trace, dans l'audit, une exécution partie sur le fournisseur de repli. */
  noteFallback(route: ResolvedRoute, used: ProviderConfig, actorId: string): void {
    this.audit.record({
      guildId: used.guildId,
      source: 'agent',
      action: 'capability.fallback',
      actorId,
      metadata: { capability: route.capability, from: route.provider.slug, to: used.slug, modelId: route.fallback?.modelId ?? route.modelId },
    });
  }

  /** La configuration d'instance a changé : ses copies par serveur suivent (voir ProviderLegacyMigration). */
  reconcileInstance(): Promise<{ checked: number; updated: number }> {
    return this.legacy.reconcileInstance();
  }

  /**
   * Clé, URL de base et modèle qui servent une capacité HORS conversation
   * (musique, image...) : la route du serveur, à défaut les valeurs
   * d'instance fournies par l'appelant. La clé reste chez l'appelant.
   */
  async credentialsFor(guildId: string | null, capability: Capability, instance: () => Promise<CapabilityCredentials | null>): Promise<CapabilityCredentials | null> {
    const route = guildId ? await this.resolve(guildId, capability).catch(() => null) : null;
    const provider = route?.provider;
    if (provider?.apiKey) return { apiKey: provider.apiKey, baseUrl: provider.baseUrl, modelId: route?.modelId ?? '' };
    return instance();
  }

  /**
   * Route de conversation d'un serveur pour un tour donné. Ordre : la
   * capacité dédiée à l'ingestion, puis le raisonnement quand la demande est
   * une action, puis la conversation par défaut.
   */
  async chatEndpoint(guildId: string | null, cause: ChatCause, preferReasoning: boolean): Promise<ResolvedRoute | null> {
    if (!guildId) return null;
    const order: Capability[] = [];
    if (cause === 'memory.ingestion') order.push('chat.ingestion');
    if (preferReasoning) order.push('chat.reasoning');
    order.push('chat.default');
    for (const capability of order) {
      const route = await this.resolve(guildId, capability);
      if (route) return { ...route, capability };
    }
    return null;
  }

  /** Exécute une capacité (hors conversation de l'agent) par sa route : le modèle est celui de la route, fournisseur principal puis repli. */
  async runCapability(
    guildId: string,
    capability: Capability,
    request: Pick<ProviderRequest, 'params'>,
    actorId = 'system',
    signal?: AbortSignal,
  ): Promise<ProviderExecutionResult> {
    const route = await this.requireRoute(guildId, capability);
    return this.withFallback(route, actorId, (adapter, provider, modelId) =>
      adapter.execute(provider, { capability, modelId, params: { ...route.params, ...request.params } }, signal),
    );
  }

  /** Tour de conversation par la route de la capacité, au format interne du bot. */
  async chat(guildId: string, capability: Capability, turn: ChatTurnInput): Promise<ChatResult> {
    const route = await this.requireRoute(guildId, capability);
    return this.withFallback(route, turn.options.userId, (adapter, provider, modelId) => adapter.chat(provider, { ...turn, modelId }));
  }

  /** Tour de conversation par une route déjà résolue (même bascule sur le repli). */
  async chatRoute(route: ResolvedRoute, turn: ChatTurnInput): Promise<ChatResult> {
    return this.withFallback(route, turn.options.userId, (adapter, provider, modelId) => adapter.chat(provider, { ...turn, modelId }));
  }

  private async requireRoute(guildId: string, capability: Capability): Promise<ResolvedRoute> {
    const route = await this.resolve(guildId, capability);
    if (!route) throw new ProviderError(`Aucune route active pour « ${capability} » sur ce serveur.`, 'unsupported');
    return route;
  }

  /** Essaie le fournisseur principal, puis le repli sur erreur éligible seulement. */
  private async withFallback<T>(
    route: ResolvedRoute,
    actorId: string,
    run: (adapter: AbstractProviderAdapter, provider: ProviderConfig, modelId: string) => Promise<T>,
  ): Promise<T> {
    const attempts = this.attemptsOf(route);
    if (attempts.length === 0) {
      throw new ProviderError(`Aucun fournisseur de la route ne sert « ${route.capability} » (${route.provider.protocol}).`, 'unsupported');
    }
    let lastError: unknown;
    for (const [index, attempt] of attempts.entries()) {
      try {
        const result = await run(attempt.adapter, attempt.provider, attempt.modelId);
        if (index > 0) this.noteFallback(route, attempt.provider, actorId);
        return result;
      } catch (error) {
        lastError = error;
        if (!isFallbackEligible(error)) throw error;
      }
    }
    throw lastError;
  }
}
