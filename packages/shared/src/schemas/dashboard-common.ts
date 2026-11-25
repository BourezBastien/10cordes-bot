import { z } from 'zod';

/**
 * CONTRAT DU PANEL WEB (Lot 2) : ce que l'API du bot échange avec le
 * dashboard, et rien d'autre. Un fichier par groupe, tous dans ce dossier :
 * - dashboard-common.ts : ce qui revient dans plusieurs groupes ;
 * - dashboard-providers.ts : fournisseurs de modèles et routes de capacités ;
 * - dashboard-integrations.ts : services métiers (PixelLab...) ;
 * - dashboard-webhooks.ts : connecteurs HTTP sortants ;
 * - dashboard-rules.ts : règles du serveur ;
 * - dashboard-usage.ts : jetons consommés et réglages de l'agent ;
 * - dashboard.ts : la façade.
 *
 * Le bot valide les corps de requête avec ces schémas et formate ses
 * réponses avec ; le dashboard lit les réponses avec. Deux règles que
 * chaque groupe respecte : jamais de secret en clair dans une réponse
 * (un statut de clé, rien de plus), et une clé vide en mise à jour
 * conserve le secret chiffré existant.
 */

/**
 * Statut d'une clé, tel qu'une API le montre : présente ou non, et de quoi
 * la reconnaître (ses quatre derniers caractères) sans jamais la lire.
 */
export const KeyStatusSchema = z.object({
  hasApiKey: z.boolean(),
  keyHint: z.string().max(16).nullable(),
});
export type KeyStatus = z.infer<typeof KeyStatusSchema>;

/** Identifiant lisible d'un objet : lettres minuscules, chiffres, tirets. */
export const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/u, 'Lettres minuscules, chiffres, tirets ou soulignés, à partir d\u0027une lettre ou d\u0027un chiffre.');

/** Identifiant Discord : 15 à 21 chiffres. */
export const SnowflakeSchema = z.string().regex(/^\d{15,21}$/u, 'Identifiant Discord attendu (15 à 21 chiffres).');

/** Enveloppe d'erreur du serveur HTTP du bot. */
export const ApiErrorBodySchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  details: z.array(z.object({ property: z.string(), constraints: z.record(z.string(), z.string()) })).optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

/** Fenêtres d'usage proposées par la page Système. */
export const USAGE_WINDOWS = ['24h', '7d', '30d'] as const;
export const UsageWindowSchema = z.enum(USAGE_WINDOWS);
export type UsageWindow = z.infer<typeof UsageWindowSchema>;
