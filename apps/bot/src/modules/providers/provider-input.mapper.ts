import type { ProviderCreate, ProviderUpdate } from '@10cordes/shared';
import { visibleOptions } from './provider-store.json';
import type { ProviderInput } from './provider-store.service';
import type { ProviderConfig } from './provider.types';

/**
 * Corps du contrat du panel vers l'écriture du store. Fonctions pures : la
 * seule traduction entre les deux conventions.
 *
 * - La clé : le dashboard ne renvoie jamais la clé enregistrée. Absente,
 *   `undefined` ou vide, le secret est conservé (le store lit « pas de nouvelle
 *   clé ») ; `null` la retire ; toute autre chaîne est la nouvelle clé.
 * - Les options et les en-têtes : absents ou vides, les actuels sont conservés ;
 *   `null` les retire tous.
 * - Les clés réservées des options (`_source`, `_model`...) marquent l'origine
 *   d'un fournisseur et le font suivre la configuration de l'instance : un
 *   formulaire ne les montre pas et ne peut pas les saisir.
 */

/** Clé du contrat vers celle du store. */
export function apiKeyInput(apiKey: string | null | undefined): string | null | undefined {
  if (apiKey === null) return null;
  return apiKey ? apiKey : undefined;
}

/**
 * Options libres, hors clés réservées : `null` (tout retirer) et l'absence
 * passent tels quels ; un objet vide, ou réduit à ses clés réservées,
 * conserve les options actuelles. Le store ne reçoit jamais un objet vide :
 * soit il conserve, soit il retire, soit il remplace.
 */
function optionsInput(extraConfig: Record<string, unknown> | null | undefined): Record<string, unknown> | null | undefined {
  if (extraConfig === undefined || extraConfig === null) return extraConfig;
  const visible = visibleOptions(extraConfig);
  return Object.keys(visible).length === 0 ? undefined : visible;
}

/** En-têtes libres : mêmes trois issues que les options (conserver, retirer, remplacer). */
function headersInput(headers: Record<string, string> | null | undefined): Record<string, string> | null | undefined {
  return headers && Object.keys(headers).length === 0 ? undefined : headers;
}

/** Création. `slug` est résolu par l'appelant : celui du corps, sinon un slug déduit du nom et libre sur le serveur. */
export function providerCreateInput(body: ProviderCreate, slug: string): ProviderInput {
  return {
    slug,
    displayName: body.displayName,
    protocol: body.protocol,
    baseUrl: body.baseUrl,
    apiKey: apiKeyInput(body.apiKey),
    authType: body.authType,
    authHeaderName: body.authHeaderName ?? undefined,
    customHeaders: body.customHeaders,
    extraConfig: optionsInput(body.extraConfig),
    enabled: body.enabled,
  };
}

/** Ce qu'une mise à jour conserve quand le corps ne le porte pas. */
export type ProviderCurrent = Pick<ProviderConfig, 'slug' | 'protocol' | 'baseUrl' | 'authType' | 'authHeaderName'>;

/** Mise à jour : le slug ne change jamais, chaque champ absent laisse le réglage actuel. */
export function providerUpdateInput(body: ProviderUpdate, current: ProviderCurrent): ProviderInput {
  return {
    slug: current.slug,
    displayName: body.displayName,
    protocol: body.protocol ?? current.protocol,
    baseUrl: body.baseUrl ?? current.baseUrl,
    apiKey: apiKeyInput(body.apiKey),
    authType: body.authType ?? current.authType,
    authHeaderName: body.authHeaderName === undefined ? current.authHeaderName : body.authHeaderName,
    customHeaders: headersInput(body.customHeaders),
    extraConfig: optionsInput(body.extraConfig),
    enabled: body.enabled,
  };
}
