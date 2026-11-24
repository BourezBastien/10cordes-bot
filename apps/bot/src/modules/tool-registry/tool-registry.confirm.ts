import type { ToolResult, ToolRunContext } from '@10cordes/shared';
import { getActionPlans } from '../action-plan/action-plan.runtime';
import type { AuditService } from '../audit/audit.service';
import type { RegistryRuntimeDeps } from './tool-registry.runtime';

/**
 * Porte de confirmation des actions (règle serveur « Confirmer les actions
 * (hors lecture) », champ `confirmDestructiveActions`), transposée de
 * discord-agent.
 *
 * Quand la règle est active, le modèle ne peut pas exécuter un tool qui
 * modifie (classification `TOOL_EFFECTS`, hors lectures et outils directs) :
 * l'action rejoint le plan de la demande en cours, et c'est le clic de son
 * auteur sur « Appliquer » qui l'exécute, après revalidation déterministe
 * (`ActionPlanPolicy`). Le modèle n'a donc jamais à relancer lui-même une
 * action approuvée.
 *
 * La règle vaut pour ce que le modèle PROPOSE en conversation. Un tool déjà
 * autorisé par le serveur ne repasse pas par la porte : un plan approuvé au
 * clic (`approvedBy`), l'action d'un membre sur une surface, une tâche du
 * système (`ctx.approvedBy`), ni ceux qu'il déclenche.
 */

/** Refus à relayer quand l'action attend une approbation. */
export function waitingApprovalSummary(name: string, count: number, full: boolean, userId: string): string {
  if (full) {
    return `Action (${name}) bloquée par la règle du serveur : le plan d\u0027approbation de cette demande est plein (${count} actions). Termine ce qui ne dépend pas d\u0027elle.`;
  }
  return (
    `Action (${name}) bloquée par la règle du serveur : sur ce serveur, toute action qui modifie attend l\u0027approbation de <@${userId}> (${count} action(s) en attente). ` +
    'Termine ce qui ne dépend pas d\u0027elle et dis ce qui reste à approuver : un panneau ✅ Appliquer / ❌ Annuler regroupera ces actions en fin de réponse (réservé au demandeur, valable 15 min). ' +
    'NE RETENTE PAS cette action, et n\u0027en appelle aucune qui dépendrait de son résultat : elle ne pourrait pas s\u0027exécuter non plus.'
  );
}

export class DestructiveConfirmationGate {
  constructor(private readonly deps: () => RegistryRuntimeDeps, private readonly audit: AuditService) {}

  /** Refus à relayer quand l'action qui modifie doit être approuvée, null si l'exécution peut continuer. */
  async refuseUnlessApproved(name: string, input: Record<string, unknown>, ctx: ToolRunContext, approvedBy?: string): Promise<ToolResult | null> {
    // Hors serveur, la règle n'existe pas.
    if (approvedBy || !ctx.guildId) return null;
    const bound = this.deps().rules;
    const rules = bound ? await bound.get(ctx.guildId).catch(() => null) : null;
    if (rules && !rules.confirmDestructiveActions) return null;
    // Règle explicitement désactivée : rien à faire. Règle illisible (dépendance
    // non liée, lecture en échec) : la porte reste FERMÉE, jamais ouverte par défaut.
    const plans = getActionPlans();
    const staged = plans?.stage(ctx, name, input) ?? null;
    this.audit.record({
      guildId: ctx.guildId,
      source: 'agent',
      action: 'rule.confirm.shown',
      actorId: ctx.userId,
      metadata: { tool: name, staged: Boolean(staged && !staged.full) },
    });
    if (!staged) {
      return {
        ok: false,
        summary:
          `Action (${name}) bloquée par la règle du serveur : une confirmation par boutons est requise ` +
          'mais impossible à afficher ici. Informe poliment l\u0027utilisateur que cette action doit être demandée depuis un salon du serveur.',
      };
    }
    return { ok: false, summary: waitingApprovalSummary(name, staged.count, staged.full, ctx.userId) };
  }
}
