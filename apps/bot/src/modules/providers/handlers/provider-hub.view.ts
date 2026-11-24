import type { ProviderAdapterRegistry } from '../provider-adapter.registry';
import type { GuildProviderService, ResolvedRoute } from '../provider-store.service';
import type { ProviderConfig } from '../provider.types';
import { describeProvider, describeRoute } from '../provider-views';
import type { ProviderHubView } from '../presenters/provider-hub.presenter';
import { nativeCapability } from '../presenters/provider-hub.parts';
import type { HubParams } from './provider-hub.params';

/**
 * Construit la vue du panneau en relisant le store. Instancié par les handlers
 * avec leurs dépendances injectées (pas par le framework). Seule sortie : des
 * vues publiques. La clé déchiffrée que `list` met en mémoire ne quitte jamais
 * cette classe.
 */
export class ProviderHubViewBuilder {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
  ) {}

  /** Fournisseurs par date de création, routes décrites, état demandé reconcilié avec ce qui existe. */
  async build(guildId: string, state: Partial<HubParams> = {}): Promise<ProviderHubView> {
    const configs = await this.store.list(guildId);
    const slugOf = (providerId: string): string => configs.find((config) => config.id === providerId)?.slug ?? providerId;
    const providers = configs.map((config) => describeProvider(config, this.capabilitiesOf(config)));
    const routes = (await this.store.routes(guildId)).map((route: ResolvedRoute) =>
      describeRoute(
        {
          capability: route.capability,
          providerId: route.provider.id,
          modelId: route.modelId,
          fallbackProviderId: route.fallback?.provider.id ?? null,
          fallbackModelId: route.fallback?.modelId ?? null,
          // Le store ne rend que des routes actives ; elle l'est tant que son fournisseur l'est.
          enabled: route.provider.enabled,
        },
        slugOf,
      ),
    );
    const known = state.p && providers.some((provider) => provider.id === state.p) ? state.p : null;
    return {
      providers,
      routes,
      // Un fournisseur supprimé depuis l'affichage désélectionne, une capacité inconnue ramène à la première.
      selectedProviderId: known,
      selectedCapability: nativeCapability(state.c),
      page: state.n ?? 1,
    };
  }

  /** Capacités natives que le protocole peut servir ; aucune si l'adaptateur n'est pas chargé. */
  private capabilitiesOf(config: ProviderConfig): string[] {
    try {
      return this.registry.resolve(config.protocol).capabilities.map(String);
    } catch {
      return [];
    }
  }
}
