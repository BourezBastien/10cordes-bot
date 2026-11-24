import type { ActionPlanService } from './action-plan.service';

/**
 * Accès runtime aux plans d'action (pattern getLlm) : la porte de
 * confirmation du registry les utilise, et le registry ne peut pas importer
 * ce module (le service injecte le registry). À appeler au moment de la
 * requête ; lié au démarrage d'`ActionPlanService`.
 */

let service: ActionPlanService | null = null;

export function bindActionPlans(instance: ActionPlanService): void {
  service = instance;
}

/** Null si le module n'est pas chargé : la porte du registry s'en sert pour refuser sans panneau. */
export function getActionPlans(): ActionPlanService | null {
  return service;
}
