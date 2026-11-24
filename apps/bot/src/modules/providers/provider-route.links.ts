/**
 * Routes de conversation liées. `chat.reasoning` et `chat.ingestion` suivent
 * `chat.default` tant qu'elles partagent exactement son modèle.
 *
 * La migration d'instance crée les trois routes sur le même modèle, et la
 * détection d'intention envoie sur `chat.reasoning` toute demande qui
 * ressemble à une action : sans cette liaison, changer « le modèle de
 * conversation » ne modifierait que la route qu'une partie des demandes
 * emprunte. Dès qu'un administrateur règle l'une des trois séparément, elle
 * devient indépendante (elle ne partage plus la cible précédente).
 */

import type { Capability } from './provider.types';

export const CONVERSATION_LINK_HEAD = 'chat.default';
export const CONVERSATION_FOLLOWERS: readonly Capability[] = ['chat.reasoning', 'chat.ingestion'];

/** Ce qu'une route cible, tel que deux routes se comparent. */
export interface RouteTarget {
  providerId: string;
  modelId: string;
  fallbackProviderId: string | null;
  fallbackModelId: string | null;
  paramsJson: string | null;
}

/** Deux routes visent-elles exactement le même modèle (fournisseur, modèle, repli, paramètres) ? */
export function sameTarget(a: RouteTarget | null | undefined, b: RouteTarget | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.providerId === b.providerId &&
    a.modelId === b.modelId &&
    (a.fallbackProviderId ?? null) === (b.fallbackProviderId ?? null) &&
    (a.fallbackModelId ?? null) === (b.fallbackModelId ?? null) &&
    (a.paramsJson ?? null) === (b.paramsJson ?? null)
  );
}
