import { PROVIDER_AUTH_TYPES, ProviderError, type ProviderAuthType, type ProviderConfig } from '../provider.types';
import { hasKeys, visibleOptions } from '../provider-store.json';

/**
 * Aller-retour entre un fournisseur et la modale « Fournisseur IA » (cinq
 * champs, limite Discord) : nom, protocole, URL de base, clé API, config
 * avancée JSON. Fonctions pures : la clé n'y entre jamais en clair sortant.
 */

/** Protocole proposé à la création. */
export const DEFAULT_PROTOCOL = 'openai-chat';

/** Message unique pour une config avancée illisible. */
const ADVANCED_INVALID =
  'Config avancée invalide : objet JSON attendu, par exemple {"authType": "header", "authHeaderName": "X-API-Key"} ou {"temperature": 0.7}.';

/** Ce que la config avancée peut régler : l'authentification, des en-têtes, et le reste en options du fournisseur. */
export interface AdvancedConfig {
  authType?: ProviderAuthType;
  authHeaderName?: string;
  customHeaders?: Record<string, string>;
  extraConfig?: Record<string, unknown>;
}

function invalid(detail: string): ProviderError {
  return new ProviderError(`Config avancée invalide : ${detail}`, 'invalid');
}

/**
 * Lit le champ « Config avancée JSON ». Vide ou `{}` : rien ne change.
 * `authType`, `authHeaderName` et `customHeaders` sont extraits vers leur
 * colonne ; toute autre clé devient une option du fournisseur.
 */
export function parseAdvancedConfig(raw: string): AdvancedConfig {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderError(ADVANCED_INVALID, 'invalid');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ProviderError(ADVANCED_INVALID, 'invalid');

  const config: AdvancedConfig = {};
  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (key === 'authType') {
      if (typeof value !== 'string' || !(PROVIDER_AUTH_TYPES as readonly string[]).includes(value)) {
        throw invalid(`authType « ${String(value).slice(0, 24)} » inconnu. Acceptés : ${PROVIDER_AUTH_TYPES.join(', ')}.`);
      }
      config.authType = value as ProviderAuthType;
    } else if (key === 'authHeaderName') {
      if (typeof value !== 'string' || !value.trim()) throw invalid('authHeaderName doit être un nom d\u0027en-tête (texte).');
      config.authHeaderName = value.trim().slice(0, 100);
    } else if (key === 'customHeaders') {
      const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : null;
      if (!entries || entries.some(([header, field]) => !header.trim() || typeof field !== 'string')) {
        throw invalid('customHeaders doit être un objet { "En-Tete": "valeur" }, chaînes uniquement.');
      }
      config.customHeaders = Object.fromEntries(entries.map(([header, field]) => [header.trim(), field as string]));
    } else {
      options[key] = value;
    }
  }
  if (hasKeys(options)) config.extraConfig = options;
  return config;
}

/**
 * Champs de modification, préremplis depuis le fournisseur. La clé n'en fait
 * jamais partie ; la config avancée montre l'authentification lorsqu'elle
 * n'est pas la valeur par défaut, les en-têtes, puis les options visibles.
 */
export function providerFormValues(config: ProviderConfig): Record<string, string> {
  const advanced: Record<string, unknown> = { ...visibleOptions(config.extraConfig) };
  if (config.authType !== 'bearer') advanced.authType = config.authType;
  if (config.authType !== 'bearer' && config.authHeaderName) advanced.authHeaderName = config.authHeaderName;
  if (hasKeys(config.customHeaders)) advanced.customHeaders = config.customHeaders;
  return {
    name: config.displayName || config.slug,
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    advanced: hasKeys(advanced) ? JSON.stringify(advanced) : '',
  };
}
