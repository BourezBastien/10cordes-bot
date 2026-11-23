import { z } from 'zod';
import { InteractionBindingSchema } from './surface-binding.js';

// ── SurfaceDefinition (layout V2 data-driven) ───────────────────────

/** Une rangée de composants : boutons ou select, portés par des bindings. */
export const SurfaceRowSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('buttons'),
    buttons: z.array(InteractionBindingSchema).min(1).max(5),
  }),
  z.object({
    kind: z.literal('select'),
    select: z.object({
      placeholder: z.string().max(100).default('Choisis une option'),
      options: z.array(InteractionBindingSchema).min(1).max(25),
    }),
  }),
]);

/** Définition complète d'une surface : en-tête, rangées de composants, état initial. */
export const SurfaceDefinitionSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(3400).optional(),
  accentColor: z.number().int().min(0).max(0xffffff).optional(),
  footer: z.string().max(200).optional(),
  thumbnailUrl: z.string().url().max(500).optional(),
  imageUrl: z.string().url().max(500).optional(),
  rows: z.array(SurfaceRowSchema).max(10),
  /** État initial JSON (compteurs, propriétaire, grilles...). */
  initialState: z.record(z.string(), z.unknown()).default({}),
});
export type SurfaceDefinition = z.infer<typeof SurfaceDefinitionSchema>;

/** Longueur UTF-8 d'une chaîne sans dépendre de Buffer (shared). */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/**
 * Validation runtime d'une définition complète : bindings aux clés uniques,
 * openModal uniquement en 1re position, budget 10 000 octets des TextDisplay.
 * (Utilisée par le renderer ET le tool surface.create.)
 */
export function validateSurfaceDefinition(definition: SurfaceDefinition): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  let textBytes = 0;
  const countBytes = (value: string | undefined) => {
    if (value) textBytes += utf8ByteLength(value);
  };
  countBytes(definition.title);
  countBytes(definition.description);
  countBytes(definition.footer);
  if (textBytes > 10_000) errors.push(`Textes trop lourds (${textBytes} octets > 10 000 : limite Components V2).`);
  for (const row of definition.rows) {
    const bindings = row.kind === 'buttons' ? row.buttons : row.select.options;
    for (const binding of bindings) {
      if (keys.has(binding.key)) errors.push(`Clé de binding dupliquée : ${binding.key}.`);
      keys.add(binding.key);
      const first = binding.pipeline[0];
      if (binding.pipeline.some((step) => step.type === 'openModal') && first?.type !== 'openModal') {
        errors.push(`openModal doit être la PREMIÈRE étape de ${binding.key} (règle des 3 s de l'API Discord).`);
      }
    }
  }
  return errors;
}
