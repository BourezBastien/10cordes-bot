import type { PlanAction } from '../../core/security/action-plan.policy';

/**
 * Plan d'action : les actions destructives d'UNE demande, regroupées pour
 * n'avoir qu'une seule approbation. Il vit dans la table des surfaces
 * interactives (kind `action-plan`), son statut tient dans le `kind` :
 * `action-plan` (en attente), `action-plan:locked` (en cours d'exécution),
 * `action-plan:closed` (terminé, quoi qu'il ait donné).
 */

export type PlanStatus = 'pending' | 'executing' | 'executed' | 'interrupted' | 'cancelled' | 'expired';

/** Compte rendu d'une exécution : ce qui a été fait, et pourquoi elle s'est arrêtée le cas échéant. */
export interface PlanReport {
  done: number;
  /** Outil de l'action qui a arrêté le plan. */
  stoppedAt?: string;
  reason?: string;
}

export interface ActionPlan {
  id: string;
  guildId: string;
  channelId: string;
  requesterId: string;
  /** Message du panneau ; nul tant qu'il n'est pas affiché. */
  messageId: string | null;
  actions: PlanAction[];
  status: PlanStatus;
  createdAt: number;
  expiresAt: number;
  report: PlanReport | null;
}

export const PLAN_LIMITS = {
  /** Actions par plan, comme discord-agent. */
  maxActions: 10,
  /** Délai d'approbation. */
  lifetimeMs: 15 * 60_000,
  /** Fenêtre pendant laquelle les actions destructives d'une même demande se regroupent. */
  stageMs: 10 * 60_000,
} as const;

/** Bases des customIds : ce que le dispatcher compare, et ce que portent les boutons décorés. */
export const PLAN_IDS = {
  apply: 'plan:apply',
  cancel: 'plan:cancel',
} as const;

/** `plan:apply~p=<id>` : identifiant du plan porté par un bouton. */
export function planIdOf(customId: string): string | null {
  const match = customId.match(/[~&]p=([a-z0-9]+)/iu);
  return match?.[1] ?? null;
}

export function planButtonId(base: string, planId: string): string {
  return `${base}~p=${planId}`;
}
