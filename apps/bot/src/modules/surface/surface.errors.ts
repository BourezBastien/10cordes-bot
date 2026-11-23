import { z } from 'zod';
import type { SurfaceDefinition } from '@10cordes/shared';

/**
 * Erreurs ACTIONNABLES des tools surface. Sans le chemin du champ fautif ni
 * la liste des clés valides, le modèle retentait à l'aveugle : « Invalid input:
 * expected string, received undefined » et « Binding « Alpha » introuvable »
 * lui coûtaient chacun plusieurs tours.
 */

/** Erreurs Zod avec le chemin du champ : « rows.0.kind : motif ». */
export function describeIssues(error: z.ZodError, max = 3): string {
  return error.issues
    .slice(0, max)
    .map((issue) => `${issue.path.length > 0 ? issue.path.map(String).join('.') : 'racine'} : ${issue.message}`)
    .join(' | ');
}

/** Pourquoi une définition (JSON en texte) a été refusée. */
export function describeDefinitionError(error: unknown): string {
  if (error instanceof z.ZodError) return describeIssues(error);
  return error instanceof SyntaxError ? `JSON illisible (${error.message.slice(0, 120)})` : 'JSON illisible';
}

/** Clés de tous les bindings d'une surface, dans l'ordre d'affichage. */
export function listBindingKeys(definition: SurfaceDefinition): string[] {
  const keys: string[] = [];
  for (const row of definition.rows) {
    const bindings = row.kind === 'buttons' ? row.buttons : row.select.options;
    for (const binding of bindings) keys.push(binding.key);
  }
  return keys;
}

/** Message quand une surface n'est pas trouvée, selon ce qui a été fourni. */
export function surfaceNotFound(surfaceId: string | undefined, messageId: string | undefined): string {
  if (!surfaceId && !messageId) {
    return 'Surface introuvable : fournis surfaceId (renvoyé par surface.create) ou messageId (le message qui l\u0027affiche).';
  }
  const given = surfaceId ? `surfaceId « ${surfaceId} »` : `messageId « ${messageId} »`;
  return `Surface introuvable : aucun ${given} dans ce serveur. Reprends l\u0027id exact renvoyé par surface.create (ou l\u0027id du message qui affiche la surface).`;
}
