import type { AppEnv } from '../../app.env';
import { decryptSecret } from '../../shared/crypto/secret-box';
import { parseModels, parseRecord } from './provider-store.json';
import type { ProviderAuthType, ProviderConfig, ProviderModel, ProviderProtocol } from './provider.types';

/**
 * Aller-retour entre une ligne `guild_providers` et la configuration qu'en
 * consomme le routeur. Fonctions pures : le déchiffrement n'a lieu qu'ici,
 * et la clé déchiffrée ne vit qu'en mémoire.
 */

/** Une ligne `guild_providers`, telle que Prisma la rend. */
export interface ProviderRow {
  id: string;
  guildId: string;
  slug: string;
  displayName: string;
  protocol: string;
  baseUrl: string;
  authType: string;
  authHeaderName: string | null;
  encryptedApiKey: string | null;
  customHeadersJson: string | null;
  extraConfigJson: string | null;
  cachedModelsJson: string | null;
  enabled: boolean;
}

/** De quoi chiffrer et déchiffrer les clés des fournisseurs. */
export interface ProviderSecrets {
  encryption?: string;
  betterAuth?: string;
  token: string;
}

/** Longueur gardée pour un identifiant de modèle. */
export const MODEL_ID_MAX = 120;
const CATALOG_MAX = 500;
const KINDS_MAX = 8;

export function providerSecrets(env: Pick<AppEnv, 'ENCRYPTION_SECRET' | 'BETTER_AUTH_SECRET' | 'token'>): ProviderSecrets {
  return { encryption: env.ENCRYPTION_SECRET, betterAuth: env.BETTER_AUTH_SECRET, token: env.token };
}

/** La configuration prête à l'emploi. La clé est DÉCHIFFRÉE : en mémoire seulement, jamais réexportée. */
export function providerFromRow(row: ProviderRow, secrets: ProviderSecrets): ProviderConfig {
  return {
    id: row.id,
    guildId: row.guildId,
    slug: row.slug,
    displayName: row.displayName,
    protocol: row.protocol as ProviderProtocol,
    baseUrl: row.baseUrl,
    authType: row.authType as ProviderAuthType,
    authHeaderName: row.authHeaderName,
    apiKey: row.encryptedApiKey ? decryptSecret(row.encryptedApiKey, secrets) : null,
    customHeaders: parseRecord(row.customHeadersJson) as Record<string, string>,
    extraConfig: parseRecord(row.extraConfigJson),
    models: parseModels(row.cachedModelsJson),
    enabled: row.enabled,
  };
}

/** Catalogue retenu : borné en nombre et en longueur, familles détectées comprises. */
export function boundedModels(models: readonly ProviderModel[]): ProviderModel[] {
  return models.slice(0, CATALOG_MAX).map((model) => ({
    id: String(model.id).slice(0, MODEL_ID_MAX),
    name: model.name?.slice(0, 120),
    kind: model.kind,
    ...(model.kinds && model.kinds.length > 0 ? { kinds: model.kinds.slice(0, KINDS_MAX) } : {}),
    contextWindow: model.contextWindow,
    maxOutput: model.maxOutput,
  }));
}
