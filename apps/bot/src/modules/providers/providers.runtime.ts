import type { CapabilityRouterService } from './capability-router.service';
import type { GuildProviderService } from './provider-store.service';

/**
 * Accès runtime au moteur de fournisseurs (pattern getLlm) : pour les
 * modules chargés AVANT ProvidersModule dans l'ordre de AppModule, qui ne
 * peuvent pas l'injecter par constructeur. À appeler au moment de la requête.
 */
let store: GuildProviderService | null = null;
let router: CapabilityRouterService | null = null;

export function bindProvidersRuntime(deps: { store: GuildProviderService; router?: CapabilityRouterService }): void {
  store = deps.store;
  router = deps.router ?? router;
}

export function getProviderStore(): GuildProviderService {
  if (!store) throw new Error('GuildProviderService non initialisé (module non chargé)');
  return store;
}

/** Le routeur des capacités : résout les routes d'un serveur (migration d'instance incluse). */
export function getProviderRouter(): CapabilityRouterService {
  if (!router) throw new Error('CapabilityRouterService non initialisé (module non chargé)');
  return router;
}
