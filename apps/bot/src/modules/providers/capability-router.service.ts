import { Injectable } from '@spraxium/common';
import type { ChatCause } from '../../shared/llm/chat-contract';
import { AuditService } from '../audit/audit.service';
import type { AbstractProviderAdapter } from './provider-adapter';
import { ProviderAdapterRegistry } from './provider-adapter.registry';
import { ProviderHealthService } from './provider-health.service';
import { ProviderLegacyMigration } from './provider-legacy.migration';
import { cooldownFor } from './model-cooldown.policy';
import { InMemoryModelCooldownStore, modelKey, type ModelCooldown } from './model-cooldown.store';
import type { ResolvedRoute } from './provider-store.service';
import { GuildProviderService } from './provider-store.service';
import { ProviderError, isFallbackEligible, type Capability, type CapabilityCredentials, type ChatResult, type ChatTurnInput, type ProviderConfig, type ProviderExecutionResult, type ProviderRequest } from './provider.types';

/** Une tentative d'exécution d'une route : un fournisseur, son modèle et l'adaptateur de son protocole. */
export interface RouteAttempt {
  provider: ProviderConfig;
  modelId: string;
  adapter: AbstractProviderAdapter;
  /** Clé du modèle au refroidissement (un serveur, un fournisseur de ce serveur, un modèle). */
  key: string;
  /** Vrai pour le modèle de repli de la route. */
  backup: boolean;
  /** Refroidissement en cours : l'appel ne part pas, et la demande reçoit l'erreur de l'appel qui l'a refroidi. */
  cooldown: ModelCooldown | null;
}

/**
 * Route une capacité du bot vers le modèle qui l'exécute sur un serveur, avec
 * bascule automatique sur le fournisseur de repli quand le fournisseur
 * principal est limité (429), indisponible (5xx) ou trop lent.
 *
 * Un modèle qui vient d'échouer est refroidi (model-cooldown.policy) : tant
 * que ça refroidit, la demande ne l'appelle pas. Elle part sur le modèle de
 * repli quand l'échec autorise la bascule, ou échoue aussitôt avec la même
 * erreur quand il ne l'autorise pas (crédit épuisé) ou qu'aucun autre modèle
 * ne sert la capacité.
 */
@Injectable()
export class CapabilityRouterService {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
    private readonly audit: AuditService,
    private readonly legacy: ProviderLegacyMigration,
    private readonly health: ProviderHealthService,
    private readonly cooldowns: InMemoryModelCooldownStore,
  ) {}

  /** Route ACTIVE d'une capacité pour ce serveur, null s'il n'y en a pas. */
  async resolve(guildId: string, capability: Capability): Promise<ResolvedRoute | null> {
    await this.legacy.ensureMigrated(guildId);
    const route = (await this.store.routes(guildId)).find((candidate) => candidate.capability === capability);
    return route && route.provider.enabled ? route : null;
  }

  /**
   * Tentatives d'une route, dans l'ordre où il faut les essayer : le
   * fournisseur principal, puis son repli s'il est actif et capable de servir
   * la capacité. Le client LLM boucle lui-même dessus quand il streame (il
   * doit reprendre la main avant tout delta publié).
   *
   * Un modèle refroidi pour un échec qui autorise la bascule passe EN DERNIER.
   * Refroidi pour un crédit épuisé, il garde son rang : la règle du repli ne
   * bascule pas, la demande doit rendre cette erreur.
   */
  async attemptsOf(route: ResolvedRoute): Promise<RouteAttempt[]> {
    const candidates: Array<{ provider: ProviderConfig; modelId: string; backup: boolean }> = [
      { provider: route.provider, modelId: route.modelId, backup: false },
      ...(route.fallback && route.fallback.provider.enabled ? [{ provider: route.fallback.provider, modelId: route.fallback.modelId, backup: true }] : []),
    ];
    const attempts: RouteAttempt[] = [];
    for (const candidate of candidates) {
      const adapter = this.registry.resolve(candidate.provider.protocol);
      if (!adapter.supports(route.capability, candidate.provider)) continue;
      const key = modelKey(route.provider.guildId, candidate.provider.id, candidate.modelId);
      attempts.push({ ...candidate, adapter, key, cooldown: await this.cooldowns.get(key) });
    }
    return attempts.filter((attempt) => !attempt.cooldown?.reroute).concat(attempts.filter((attempt) => attempt.cooldown?.reroute));
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

  /**
   * Issue d'un appel RÉEL sur un modèle, portée à sa santé et à son
   * refroidissement. Le client LLM et l'exécution d'une capacité passent par
   * ici : une seule lecture d'un succès et d'un échec.
   */
  async noteSuccess(attempt: RouteAttempt): Promise<void> {
    await this.cooldowns.clear(attempt.key);
    this.health.record(attempt.provider.guildId, attempt.provider.id, {
      ok: true,
      cooldownUntil: await this.cooldowns.latestUntil(attempt.provider.guildId, attempt.provider.id),
    });
  }

  async noteFailure(attempt: RouteAttempt, error: unknown, transient?: boolean): Promise<void> {
    const decision = cooldownFor(error);
    const until = decision ? Date.now() + decision.ms : null;
    if (decision && until !== null) {
      await this.cooldowns.set(attempt.key, { reason: decision.reason, reroute: decision.reroute, until, error });
    }
    this.health.record(attempt.provider.guildId, attempt.provider.id, { ok: false, error, transient, secret: attempt.provider.apiKey, cooldownUntil: until ?? undefined });
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

  /** Essaie le fournisseur principal, puis le repli sur erreur éligible seulement. Un modèle refroidi n'est pas appelé. */
  private async withFallback<T>(
    route: ResolvedRoute,
    actorId: string,
    run: (adapter: AbstractProviderAdapter, provider: ProviderConfig, modelId: string) => Promise<T>,
  ): Promise<T> {
    const attempts = await this.attemptsOf(route);
    if (attempts.length === 0) {
      throw new ProviderError(`Aucun fournisseur de la route ne sert « ${route.capability} » (${route.provider.protocol}).`, 'unsupported');
    }
    let lastError: unknown;
    for (const [index, attempt] of attempts.entries()) {
      const last = index === attempts.length - 1;
      if (attempt.cooldown) {
        // Modèle refroidi : l'appel ne part pas, l'issue est celle de l'appel qui l'a refroidi.
        lastError = attempt.cooldown.error;
        if (last || !isFallbackEligible(lastError)) throw lastError;
        continue;
      }
      try {
        const result = await run(attempt.adapter, attempt.provider, attempt.modelId);
        await this.noteSuccess(attempt);
        if (attempt.backup) this.noteFallback(route, attempt.provider, actorId);
        return result;
      } catch (error) {
        await this.noteFailure(attempt, error);
        lastError = error;
        if (!isFallbackEligible(error)) throw error;
      }
    }
    throw lastError;
  }
}
