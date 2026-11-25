import { z } from 'zod';
import { SlugSchema } from './dashboard-common.js';

/**
 * Connecteurs HTTP sortants : contrat des routes
 * `/api/v1/guilds/:guildId/webhooks`. Un connecteur est un endpoint REST
 * qu'un déclencheur, une recette ou le modèle (outil `webhook.call`) peut
 * appeler. L'URL est validée (https, hôte public) et relayée par la garde des
 * requêtes sortantes ; les en-têtes secrets sont chiffrés et ne ressortent
 * jamais : l'API montre leurs noms.
 */

export const WEBHOOK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const WebhookMethodSchema = z.enum(WEBHOOK_METHODS);
export type WebhookMethod = z.infer<typeof WebhookMethodSchema>;

export const WEBHOOK_AUTH_TYPES = ['none', 'bearer', 'header'] as const;
export const WebhookAuthTypeSchema = z.enum(WEBHOOK_AUTH_TYPES);
export type WebhookAuthType = z.infer<typeof WebhookAuthTypeSchema>;

/** En-têtes libres : noms et valeurs bornés. */
const HeaderRecordSchema = z.record(z.string().trim().min(1).max(60), z.string().max(1000));

/** Chemin pointé d'une réponse (« data.result », « 0.name »). */
export const ExtractPathSchema = z
  .string()
  .trim()
  .max(160)
  .regex(/^[A-Za-z0-9_.-]*$/u, 'Champs séparés par des points (ex. : data.result).');

/** Un connecteur, tel que l'API le montre : jamais les en-têtes secrets. */
export const WebhookEndpointViewSchema = z.object({
  webhookId: z.string(),
  slug: SlugSchema,
  name: z.string().max(80),
  method: WebhookMethodSchema,
  url: z.string().max(500),
  /** Hôte de l'URL cible, sans le chemin. */
  domain: z.string().max(253),
  authType: WebhookAuthTypeSchema,
  authHeaderName: z.string().max(60).nullable(),
  /** En-têtes libres, visibles. */
  publicHeaders: HeaderRecordSchema,
  /** Noms des en-têtes secrets : leurs valeurs ne sortent jamais. */
  secretHeaderNames: z.array(z.string().max(60)),
  /** Gabarit du corps de la requête (objet JSON), ou null pour aucun corps. */
  requestTemplate: z.unknown().nullable(),
  responseExtractPath: z.string().nullable(),
  enabled: z.boolean(),
  lastHttpStatus: z.number().int().nullable(),
  /** Date ISO du dernier appel enregistré. */
  lastCheckedAt: z.string().nullable(),
  lastError: z.string().max(300).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WebhookEndpointView = z.infer<typeof WebhookEndpointViewSchema>;

/** Création d'un connecteur. */
export const WebhookCreateSchema = z.object({
  slug: SlugSchema,
  name: z.string().trim().min(1).max(80),
  method: WebhookMethodSchema,
  url: z.string().trim().min(8).max(500),
  authType: WebhookAuthTypeSchema.optional(),
  authHeaderName: z.string().trim().max(60).nullable().optional(),
  publicHeaders: HeaderRecordSchema.optional(),
  /** Chiffrés à l'écriture, jamais relus par l'API. */
  secretHeaders: HeaderRecordSchema.optional(),
  /** Objet JSON ; `{{payload}}` reçoit la charge utile de l'appel. */
  requestTemplate: z.unknown().nullable().optional(),
  responseExtractPath: ExtractPathSchema.nullable().optional(),
  enabled: z.boolean().optional(),
});
export type WebhookCreate = z.infer<typeof WebhookCreateSchema>;

/**
 * Mise à jour d'un connecteur. Absents, les en-têtes secrets sont conservés ;
 * `null` les retire. `slug` et `method` ne se changent pas.
 */
export const WebhookUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: z.string().trim().min(8).max(500).optional(),
  authType: WebhookAuthTypeSchema.optional(),
  authHeaderName: z.string().trim().max(60).nullable().optional(),
  publicHeaders: HeaderRecordSchema.nullable().optional(),
  secretHeaders: HeaderRecordSchema.nullable().optional(),
  requestTemplate: z.unknown().nullable().optional(),
  responseExtractPath: ExtractPathSchema.nullable().optional(),
  enabled: z.boolean().optional(),
});
export type WebhookUpdate = z.infer<typeof WebhookUpdateSchema>;

/** Résultat d'un ping d'essai. */
export const WebhookPingResultSchema = z.object({
  ok: z.boolean(),
  status: z.number().int().nullable(),
  summary: z.string().max(600),
  /** Ce que le chemin d'extraction a trouvé, s'il y en a un. */
  extracted: z.unknown().nullable(),
  ms: z.number().int().min(0),
});
export type WebhookPingResult = z.infer<typeof WebhookPingResultSchema>;
