import { z } from 'zod';

// ── Modals (max 5 champs, règle API v10) ───────────────────────────

/** Un champ de modal (règle API v10 : 5 champs au plus). */
export const ModalInputSchema = z.object({
  id: z.string().min(1).max(45),
  label: z.string().min(1).max(45),
  style: z.enum(['short', 'paragraph']).default('short'),
  placeholder: z.string().max(100).optional(),
  required: z.boolean().default(true),
  minLength: z.number().int().min(0).max(4000).optional(),
  maxLength: z.number().int().min(1).max(4000).optional(),
});
export type ModalInput = z.infer<typeof ModalInputSchema>;

/** Un modal ouvert par l'étape openModal d'un pipeline. */
export const ModalSpecSchema = z.object({
  title: z.string().min(1).max(45),
  inputs: z.array(ModalInputSchema).min(1).max(5),
});
export type ModalSpec = z.infer<typeof ModalSpecSchema>;
