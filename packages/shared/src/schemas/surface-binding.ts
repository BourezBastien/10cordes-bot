import { z } from 'zod';
import { AccessPolicySchema } from './surface-access-policy.js';
import { PipelineStepSchema } from './surface-pipeline-step.js';

// ── InteractionBinding ──────────────────────────────────────────────

/** Un bouton ou une option de select : clé stable, accès, pipeline à exécuter au clic. */
export const InteractionBindingSchema = z.object({
  /** Clé courte stable : voyage dans le customId (surface:act~b=key). */
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,29}$/u, 'clé kebab-case ≤30 chars'),
  label: z.string().min(1).max(80),
  emoji: z.string().max(16).optional(),
  style: z.enum(['primary', 'secondary', 'success', 'danger']).default('primary'),
  disabled: z.boolean().default(false),
  /** Valeur d'option (select) ou description. */
  description: z.string().max(100).optional(),
  access: AccessPolicySchema.default({}),
  /** Étapes du clic. Plafond 20 : un jeu (piocher, ranger dans l'état, re-rendre,
   * répondre) dépassait 10 et voyait sa surface refusée pour cause de taille. */
  pipeline: z.array(PipelineStepSchema).min(1).max(20),
  /** Select multi : valeurs min/max sélectionnables. */
  minValues: z.number().int().min(1).max(25).optional(),
  maxValues: z.number().int().min(1).max(25).optional(),
});
export type InteractionBinding = z.infer<typeof InteractionBindingSchema>;
