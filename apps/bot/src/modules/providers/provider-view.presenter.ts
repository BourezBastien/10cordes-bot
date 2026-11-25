import { NATIVE_CAPABILITIES } from '@10cordes/shared';
import type { CapabilityRouteView, KeyStatus, ProviderModel, ProviderStatus, ProviderView, RouteTarget } from '@10cordes/shared';
import { keyHintOf } from '../../shared/crypto/key-hint';
import { redactSecret } from './adapters/generic-http.errors';
import { instanceSourceOf } from './instance-defaults';
import { kindsOf } from './provider-model.kinds';
import { CONVERSATION_FOLLOWERS, CONVERSATION_LINK_HEAD, sameTarget, type RouteTarget as RouteLink } from './provider-route.links';
import type { ResolvedRoute } from './provider-store.service';
import type { ProviderConfig, ProviderModel as StoredModel } from './provider.types';

/**
 * Vues PURES du contrat du panel : un fournisseur, ses modèles, les routes
 * d'un serveur. Données en entrée, vue en sortie, aucun appel. C'est la seule
 * porte de sortie d'un fournisseur vers l'API : la clé déchiffrée y entre
 * (pour dire qu'elle existe et en donner l'indice) et n'en sort jamais. Les
 * textes sont masqués une seconde fois ici, et les valeurs sont bornées aux
 * limites du contrat, quand bien même une ligne ancienne les dépasserait.
 */

/** Bornes du contrat. */
const NAME_MAX = 120;
const HEADER_NAME_MAX = 60;
const ERROR_MAX = 300;
const DOMAIN_MAX = 253;
const KINDS_MAX = 8;

/** Statut de la clé : présente ou non, et de quoi la reconnaître sans jamais la lire (règle unique, key-hint.ts). */
export function keyStatusOf(apiKey: string | null): KeyStatus {
  return { hasApiKey: Boolean(apiKey), keyHint: keyHintOf(apiKey) };
}

/** Hôte de l'URL de base, sans le chemin ni le port. */
function domainOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.slice(0, DOMAIN_MAX);
  } catch {
    return baseUrl.slice(0, DOMAIN_MAX);
  }
}

/** Entier strictement positif, sinon null (la borne du contrat). */
function positiveOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** Un modèle du catalogue, dans les bornes du contrat. Sans marque, un modèle est découvert (la forme historique du catalogue). */
export function providerModelViewOf(model: StoredModel): ProviderModel {
  return {
    id: model.id.slice(0, NAME_MAX),
    name: model.name ? model.name.slice(0, NAME_MAX) : null,
    kinds: kindsOf(model).slice(0, KINDS_MAX),
    contextWindow: positiveOrNull(model.contextWindow),
    maxOutput: positiveOrNull(model.maxOutput),
    origin: model.origin === 'manual' ? 'manual' : 'discovered',
  };
}

/** Un fournisseur, tel que l'API le montre : jamais la clé. */
export function providerViewOf(config: ProviderConfig, status: ProviderStatus): ProviderView {
  return {
    providerId: config.id,
    slug: config.slug,
    displayName: config.displayName.slice(0, 80),
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    domain: domainOf(config.baseUrl),
    source: instanceSourceOf(config) ? 'instance' : 'guild',
    enabled: config.enabled,
    authType: config.authType,
    authHeaderName: config.authHeaderName?.slice(0, HEADER_NAME_MAX) ?? null,
    key: keyStatusOf(config.apiKey),
    customHeaderNames: Object.keys(config.customHeaders).map((header) => header.slice(0, HEADER_NAME_MAX)),
    models: config.models.map(providerModelViewOf),
    // L'erreur retenue vient d'un fournisseur : certains la recopient avec la clé. Masquée avant la troncature.
    status: { ...status, lastError: status.lastError ? redactSecret(status.lastError, config.apiKey).slice(0, ERROR_MAX) || null : null },
  };
}

/** Cible d'une route : un fournisseur (nommé par son slug) et son modèle. */
function targetView(providerId: string, modelId: string, slugOf: (providerId: string) => string): RouteTarget {
  return { providerId, providerSlug: slugOf(providerId), modelId };
}

/**
 * Ce qu'une route résolue cible, tel que le store compare deux routes
 * (`sameTarget`) quand il décide qu'une route de conversation en suit une
 * autre.
 */
function linkOf(route: ResolvedRoute): RouteLink {
  return {
    providerId: route.provider.id,
    modelId: route.modelId,
    fallbackProviderId: route.fallback?.provider.id ?? null,
    fallbackModelId: route.fallback?.modelId ?? null,
    paramsJson: JSON.stringify(route.params),
  };
}

/** Une capacité : sa route (principale et repli), ou rien quand elle n'est pas liée. */
function routeViewOf(capability: string, route: ResolvedRoute | null, head: RouteLink | null, slugOf: (providerId: string) => string): CapabilityRouteView {
  const link = route ? linkOf(route) : null;
  return {
    capability: capability as CapabilityRouteView['capability'],
    main: link ? targetView(link.providerId, link.modelId, slugOf) : null,
    fallback: link?.fallbackProviderId ? targetView(link.fallbackProviderId, link.fallbackModelId ?? link.modelId, slugOf) : null,
    params: route?.params ?? {},
    // Une suite de `chat.default` le reste tant qu'elle partage exactement sa cible : le prochain changement l'entraînera.
    followsDefault: link !== null && (CONVERSATION_FOLLOWERS as readonly string[]).includes(capability) && sameTarget(link, head),
  };
}

/**
 * Les routes d'un serveur : les capacités natives dans l'ordre de la matrice
 * de routage (liées ou non), puis les capacités `custom.*` présentes.
 */
export function capabilityRouteViewsOf(routes: readonly ResolvedRoute[], slugOf: (providerId: string) => string): CapabilityRouteView[] {
  const byCapability = new Map(routes.map((route) => [route.capability as string, route]));
  const head = byCapability.get(CONVERSATION_LINK_HEAD) ?? null;
  const customs = [...byCapability.keys()].filter((capability) => capability.startsWith('custom.')).sort();
  return [...NATIVE_CAPABILITIES, ...customs].map((capability) => routeViewOf(capability, byCapability.get(capability) ?? null, head ? linkOf(head) : null, slugOf));
}
