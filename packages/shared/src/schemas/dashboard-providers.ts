import { z } from 'zod';
import { KeyStatusSchema, SlugSchema } from './dashboard-common.js';

/**
 * Fournisseurs de modèles IA et routes de capacités : contrat des routes
 * `/api/v1/guilds/:guildId/providers` et `/capabilities`. Les protocoles,
 * types d'authentification et capacités natives sont définis ICI : le bot les
 * réexporte, le dashboard les affiche.
 */

export const PROVIDER_PROTOCOLS = ['openai-chat', 'anthropic-messages', 'kie-unified', 'generic-http'] as const;
export const ProviderProtocolSchema = z.enum(PROVIDER_PROTOCOLS);
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;

export const PROVIDER_AUTH_TYPES = ['bearer', 'header', 'query', 'none'] as const;
export const ProviderAuthTypeSchema = z.enum(PROVIDER_AUTH_TYPES);
export type ProviderAuthType = z.infer<typeof ProviderAuthTypeSchema>;

/** Les capacités natives du bot, dans l'ordre de la matrice de routage. */
export const NATIVE_CAPABILITIES = [
  'chat.default',
  'chat.reasoning',
  'chat.ingestion',
  'image.generate',
  'image.edit',
  'music.generate',
  'tts.speak',
  'video.generate',
  'web.search',
] as const;
export const NativeCapabilitySchema = z.enum(NATIVE_CAPABILITIES);
export type NativeCapability = z.infer<typeof NativeCapabilitySchema>;

/** Famille d'une capacité : le type de modèle qu'il faut pour la servir. */
export const CAPABILITY_KINDS = ['chat', 'image', 'music', 'tts', 'video', 'search', 'custom'] as const;
export const CapabilityKindSchema = z.enum(CAPABILITY_KINDS);
export type CapabilityKind = z.infer<typeof CapabilityKindSchema>;

/** Une capacité native, ou une capacité `custom.*` bien formée. */
export const CapabilitySchema = z
  .string()
  .max(56)
  .refine(
    (value) =>
      (NATIVE_CAPABILITIES as readonly string[]).includes(value) ||
      (value.startsWith('custom.') && /^[a-z0-9][a-z0-9_.-]{1,47}$/u.test(value.slice('custom.'.length))),
    'Capacité inconnue : native du bot, ou de la forme custom.nom.',
  );
export type Capability = NativeCapability | `custom.${string}`;

/**
 * Famille de chaque capacité native. Une table, pas la tête du nom :
 * `web.search` est une recherche, et sa tête disait « custom », ce qui sautait
 * le contrôle du modèle et listait tout le catalogue. Le compilateur réclame
 * la ligne d'une capacité native nouvelle.
 */
const NATIVE_CAPABILITY_KINDS: Readonly<Record<NativeCapability, CapabilityKind>> = {
  'chat.default': 'chat',
  'chat.reasoning': 'chat',
  'chat.ingestion': 'chat',
  'image.generate': 'image',
  'image.edit': 'image',
  'music.generate': 'music',
  'tts.speak': 'tts',
  'video.generate': 'video',
  'web.search': 'search',
};

/** Famille d'une capacité : sa table si elle est native, sinon celle de sa tête, sinon `custom`. */
export function capabilityKind(capability: string): CapabilityKind {
  if ((NATIVE_CAPABILITIES as readonly string[]).includes(capability)) return NATIVE_CAPABILITY_KINDS[capability as NativeCapability];
  const head = capability.split('.')[0] ?? '';
  return (CAPABILITY_KINDS as readonly string[]).includes(head) ? (head as CapabilityKind) : 'custom';
}

/** Ce qu'un modèle sait faire. */
export const MODEL_KINDS = ['chat', 'image', 'music', 'tts', 'video', 'search', 'other'] as const;
export const ModelKindSchema = z.enum(MODEL_KINDS);
export type ModelKind = z.infer<typeof ModelKindSchema>;

/** Longueur gardée pour un identifiant de modèle. */
export const MODEL_ID_MAX = 120;

/** Un modèle du catalogue d'un fournisseur. */
export const ProviderModelSchema = z.object({
  id: z.string().min(1).max(MODEL_ID_MAX),
  name: z.string().max(120).nullable(),
  kinds: z.array(ModelKindSchema),
  contextWindow: z.number().int().positive().nullable(),
  maxOutput: z.number().int().positive().nullable(),
  /** `discovered` : lu dans le catalogue du fournisseur ; `manual` : slug ajouté à la main. */
  origin: z.enum(['discovered', 'manual']),
});
export type ProviderModel = z.infer<typeof ProviderModelSchema>;

/** État d'un fournisseur, tel que le présente sa carte. */
export const ProviderStatusSchema = z.object({
  /** `unknown` : aucun appel depuis le démarrage. */
  state: z.enum(['active', 'cooldown', 'error', 'unknown']),
  /** Fin du refroidissement (date ISO), quand l'état est `cooldown`. */
  cooldownUntil: z.string().nullable(),
  lastError: z.string().max(300).nullable(),
  lastHttpStatus: z.number().int().nullable(),
  lastCheckedAt: z.string().nullable(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

/** Un fournisseur, tel que l'API le montre : jamais la clé. */
export const ProviderViewSchema = z.object({
  providerId: z.string(),
  slug: SlugSchema,
  displayName: z.string().max(80),
  protocol: ProviderProtocolSchema,
  baseUrl: z.string().max(500),
  /** Hôte de l'URL de base, sans le chemin. */
  domain: z.string().max(253),
  /** `instance` : copie de la configuration de l'instance, il la suit ; `guild` : propre au serveur. */
  source: z.enum(['instance', 'guild']),
  enabled: z.boolean(),
  authType: ProviderAuthTypeSchema,
  authHeaderName: z.string().max(60).nullable(),
  key: KeyStatusSchema,
  /** En-têtes libres, hors authentification (jamais secrets : ceux-ci sont dans la clé). */
  customHeaderNames: z.array(z.string().max(60)),
  models: z.array(ProviderModelSchema),
  status: ProviderStatusSchema,
});
export type ProviderView = z.infer<typeof ProviderViewSchema>;

const ApiKeySchema = z.string().max(4096);
const BaseUrlSchema = z.string().trim().min(8).max(500);

/** Création d'un fournisseur. */
export const ProviderCreateSchema = z.object({
  slug: SlugSchema.optional(),
  displayName: z.string().trim().min(1).max(80),
  protocol: ProviderProtocolSchema,
  baseUrl: BaseUrlSchema,
  apiKey: ApiKeySchema.optional(),
  authType: ProviderAuthTypeSchema.optional(),
  authHeaderName: z.string().trim().max(60).nullable().optional(),
  customHeaders: z.record(z.string().max(60), z.string().max(500)).optional(),
  extraConfig: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});
export type ProviderCreate = z.infer<typeof ProviderCreateSchema>;

/**
 * Mise à jour d'un fournisseur. Absente ou vide, la clé est conservée ;
 * `null` la retire. `slug` ne se change pas.
 */
export const ProviderUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  protocol: ProviderProtocolSchema.optional(),
  baseUrl: BaseUrlSchema.optional(),
  apiKey: ApiKeySchema.nullable().optional(),
  authType: ProviderAuthTypeSchema.optional(),
  authHeaderName: z.string().trim().max(60).nullable().optional(),
  customHeaders: z.record(z.string().max(60), z.string().max(500)).nullable().optional(),
  extraConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type ProviderUpdate = z.infer<typeof ProviderUpdateSchema>;

/** Ajout d'un slug de modèle à la main. */
export const ProviderModelAddSchema = z.object({ modelId: z.string().trim().min(1).max(MODEL_ID_MAX) });
export type ProviderModelAdd = z.infer<typeof ProviderModelAddSchema>;

/** Résultat d'un test de connexion. */
export const ProviderTestResultSchema = z.object({
  ok: z.boolean(),
  summary: z.string().max(600),
  modelsFound: z.number().int().min(0),
  status: ProviderStatusSchema,
});
export type ProviderTestResult = z.infer<typeof ProviderTestResultSchema>;

/** Ce qu'une route cible : un fournisseur et son modèle. */
export const RouteTargetSchema = z.object({
  providerId: z.string(),
  providerSlug: z.string(),
  modelId: z.string().max(MODEL_ID_MAX),
});
export type RouteTarget = z.infer<typeof RouteTargetSchema>;

/** Une route de capacité : modèle principal, modèle de repli. */
export const CapabilityRouteViewSchema = z.object({
  capability: CapabilitySchema,
  main: RouteTargetSchema.nullable(),
  fallback: RouteTargetSchema.nullable(),
  params: z.record(z.string(), z.unknown()),
  /** Vrai pour une route de conversation qui suit encore la cible exacte de `chat.default`. */
  followsDefault: z.boolean(),
});
export type CapabilityRouteView = z.infer<typeof CapabilityRouteViewSchema>;

/** Association d'une capacité à un modèle (le reste de la route est conservé). */
export const CapabilityBindSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().trim().min(1).max(MODEL_ID_MAX),
  /** `null` retire le repli ; absent : le repli actuel est conservé. */
  fallbackProviderId: z.string().nullable().optional(),
  fallbackModelId: z.string().max(MODEL_ID_MAX).nullable().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type CapabilityBind = z.infer<typeof CapabilityBindSchema>;

/** Retrait d'une route (la capacité redevient non liée). */
export const CapabilityUnbindSchema = z.object({});
