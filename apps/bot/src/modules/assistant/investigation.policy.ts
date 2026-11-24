/**
 * INVESTIGATION SILENCIEUSE (transposé de discord-agent) : une recherche
 * multi-sources ne se raconte pas appel par appel. La ligne de statut dit une
 * seule fois que le bot consulte ses sources, puis se tait jusqu'à la réponse.
 *
 * Règle STABLE : seules les LECTURES DE RECHERCHE se taisent (recherche web,
 * actualités, flux, pages, dépôts). Une action, un montage ou une lecture
 * de serveur continue de se narrater : l'utilisateur voit ce que le bot
 * fait sur SON serveur, pas comment il se documente.
 */

/** Nom de tool qui documente sans rien toucher au serveur. */
const RESEARCH_TOOL_RE = /^(?:search|read|fetch|http\.|getNews|githubRepo|channel\.history|web\.)/u;
/** Chercher un tool ou une recette fait partie d'un montage : cela se raconte. */
const RESEARCH_EXCLUDED: ReadonlySet<string> = new Set(['search_tools', 'search_skills']);

export class InvestigationPolicy {
  /** Cet appel est-il une lecture de recherche, à ne pas narrater ? */
  isQuietRead(toolName: string): boolean {
    return RESEARCH_TOOL_RE.test(toolName) && !RESEARCH_EXCLUDED.has(toolName);
  }

  /** La ligne de statut doit-elle raconter cet appel sous son nom ? */
  narrates(toolName: string): boolean {
    return !this.isQuietRead(toolName);
  }
}

/** Instance singleton (la policy est sans état). */
export const investigationPolicy = new InvestigationPolicy();

/** Ligne unique de la phase de lecture, posée une fois par demande. */
export const READING_LINE = '[SOURCES] Je consulte mes sources...';
