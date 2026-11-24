const MASK = '[masqué]';

/**
 * Entrée d'un tool telle qu'elle est AUDITÉE. Le registre journalise l'appel
 * complet de chaque tool (traçabilité totale) : un paramètre déclaré sensible
 * (clé API donnée en langage naturel) y est remplacé, sinon le secret
 * resterait en clair dans la table d'audit.
 */
export function redactToolInput(input: unknown, sensitiveKeys: readonly string[] | undefined): Record<string, unknown> {
  const record = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  if (!sensitiveKeys || sensitiveKeys.length === 0) return record;
  const redacted: Record<string, unknown> = { ...record };
  for (const key of sensitiveKeys) {
    if (redacted[key] !== undefined) redacted[key] = MASK;
  }
  return redacted;
}
