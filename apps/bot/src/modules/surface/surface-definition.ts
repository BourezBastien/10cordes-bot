import { InteractionBindingSchema, type InteractionBinding, type SurfaceDefinition } from '@10cordes/shared';

/**
 * Lecture et modification en mémoire d'une SurfaceDefinition : recherche de
 * bindings par clé et patches de composants. Fonctions pures, la persistance
 * reste du ressort de SurfaceStore.
 */

/** Bindings de toutes les rangées, boutons comme options de menu. */
function allBindings(definition: SurfaceDefinition): InteractionBinding[] {
  return definition.rows.flatMap((row) => (row.kind === 'buttons' ? row.buttons : row.select.options));
}

/** Binding portant cette clé, sur n'importe quelle rangée. */
export function findBinding(definition: SurfaceDefinition, key: string): InteractionBinding | null {
  return allBindings(definition).find((binding) => binding.key === key) ?? null;
}

/** Une étape de pipeline est-elle un patch de composant (clé de binding + patch objet) ? */
export function isBindingPatch(step: Record<string, unknown>): boolean {
  return typeof step.binding === 'string' && Boolean(step.patch) && typeof step.patch === 'object';
}

/**
 * Applique les patches updateComponent accumulés dans steps[] (binding + patch).
 * Rend vrai si au moins un binding a été modifié.
 */
export function applyBindingPatches(definition: SurfaceDefinition, steps: ReadonlyArray<Record<string, unknown>>): boolean {
  let changed = false;
  for (const step of steps) {
    if (!isBindingPatch(step)) continue;
    const target = findBinding(definition, step.binding as string);
    if (target) {
      Object.assign(target, step.patch as Record<string, unknown>);
      changed = true;
    }
  }
  return changed;
}

/** Validation exportée pour les handlers (binding par clé). */
export function parseBinding(raw: unknown): InteractionBinding | null {
  const parsed = InteractionBindingSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
