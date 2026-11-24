import type { ProviderConfig, ProviderModel } from './provider.types';
import { capabilityKind, capabilityLabel } from './provider.types';
import { instanceSourceOf } from './instance-defaults';

/**
 * Vues PUBLIQUES (sans secret) d'un fournisseur et d'une route : la seule
 * forme qui sort du module (tools, audit, panneau).
 */

export type ProviderOrigin = 'instance' | 'server';

export interface ProviderView {
  id: string;
  slug: string;
  displayName: string;
  protocol: ProviderConfig['protocol'];
  baseUrl: string;
  authType: ProviderConfig['authType'];
  /** Une clé est enregistrée (jamais laquelle). */
  hasKey: boolean;
  enabled: boolean;
  models: number;
  /** Catalogue du fournisseur (découvert ou saisi). */
  catalog: ProviderModel[];
  /** Capacités natives que le protocole peut servir. */
  capabilities: string[];
  /** Copie de la configuration d'instance (elle suit l'instance) ou fournisseur créé par un administrateur du serveur. */
  origin?: ProviderOrigin;
}

export interface RouteView {
  capability: string;
  label: string;
  kind: string;
  providerId: string;
  providerSlug: string;
  modelId: string;
  /** `fournisseur/modèle` de repli, s'il y en a un. */
  fallback: string | null;
  enabled: boolean;
}

export function describeProvider(config: ProviderConfig, adapterCapabilities: readonly string[]): ProviderView {
  return {
    id: config.id,
    slug: config.slug,
    displayName: config.displayName,
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    authType: config.authType,
    hasKey: config.apiKey !== null && config.apiKey.length > 0,
    enabled: config.enabled,
    models: config.models.length,
    catalog: config.models.slice(0, 500),
    capabilities: [...adapterCapabilities],
    origin: instanceSourceOf(config) ? 'instance' : 'server',
  };
}

export function describeRoute(route: {
  capability: string;
  providerId: string;
  modelId: string;
  fallbackProviderId: string | null;
  fallbackModelId: string | null;
  enabled: boolean;
}, slugOf: (providerId: string) => string): RouteView {
  return {
    capability: route.capability,
    label: capabilityLabel(route.capability),
    kind: capabilityKind(route.capability),
    providerId: route.providerId,
    providerSlug: slugOf(route.providerId),
    modelId: route.modelId,
    fallback: route.fallbackProviderId ? `${slugOf(route.fallbackProviderId)}/${route.fallbackModelId ?? route.modelId}` : null,
    enabled: route.enabled,
  };
}
