import type { BotTool } from '@10cordes/shared';
import type { GuildMember } from 'discord.js';
import { actionPlanPolicy, type PlanAction } from '../../core/security/action-plan.policy';
import type { DroppedAction } from './action-plan.types';

/** Ce qu'il reste d'une liste d'actions après la revue : celles que le demandeur peut exécuter, et les autres. */
export interface ReviewedActions {
  kept: PlanAction[];
  dropped: DroppedAction[];
}

/**
 * Revue des actions AVANT l'affichage d'un plan : une action que le
 * demandeur ne peut pas exécuter (permission dans le salon visé, hiérarchie,
 * identifiant mal formé) n'est pas proposée, et le panneau dit pourquoi.
 * On ne demande pas d'approuver ce qui serait refusé au clic.
 *
 * Sans membre résolu (demandeur hors du serveur), tout est proposé : la
 * revue aura lieu au clic, comme pour chaque action.
 */
export function reviewPlanActions(
  member: GuildMember | null,
  actions: readonly PlanAction[],
  lookup: (name: string) => BotTool | undefined,
): ReviewedActions {
  const kept: PlanAction[] = [];
  const dropped: DroppedAction[] = [];
  for (const action of actions) {
    const review = member ? actionPlanPolicy.review(member, action, lookup(action.tool)) : { ok: true as const };
    if (review.ok) kept.push(action);
    else dropped.push({ tool: action.tool, reason: review.reason });
  }
  return { kept, dropped };
}
