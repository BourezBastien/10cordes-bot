import { z } from 'zod';
import { KeyStatusSchema, SlugSchema } from './dashboard-common.js';

/**
 * Services métiers dédiés (PixelLab et futurs connecteurs) : contrat des
 * routes `/api/v1/guilds/:guildId/integrations`. Ce ne sont jamais des
 * fournisseurs de modèles IA : ils ont leurs propres outils, et la clé vient
 * de la configuration de l'instance ou du serveur.
 */

export const IntegrationViewSchema = z.object({
  slug: SlugSchema,
  name: z.string().max(60),
  /** Outils du bot que l'intégration débloque. */
  tools: z.array(z.string().max(60)),
  /** `instance` : clé de la configuration de l'instance ; `guild` : clé propre au serveur ; `none` : aucune clé. */
  source: z.enum(['instance', 'guild', 'none']),
  enabled: z.boolean(),
  baseUrl: z.string().max(500).nullable(),
  key: KeyStatusSchema,
  model: z.string().max(120).nullable(),
});
export type IntegrationView = z.infer<typeof IntegrationViewSchema>;

/**
 * Réglage du serveur pour une intégration. Absente ou vide, la clé est
 * conservée ; `null` la retire (le serveur revient à la clé de l'instance).
 */
export const IntegrationUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().max(4096).nullable().optional(),
  baseUrl: z.string().trim().max(500).nullable().optional(),
});
export type IntegrationUpdate = z.infer<typeof IntegrationUpdateSchema>;

/** Retrait du réglage du serveur : l'intégration suit de nouveau l'instance. */
export const IntegrationRemoveSchema = z.object({});

/** Résultat d'un test d'accès. */
export const IntegrationTestResultSchema = z.object({
  ok: z.boolean(),
  summary: z.string().max(600),
  /** Statut HTTP de la réponse du service, s'il y en a eu une. */
  status: z.number().int().nullable(),
  ms: z.number().int().min(0),
});
export type IntegrationTestResult = z.infer<typeof IntegrationTestResultSchema>;
