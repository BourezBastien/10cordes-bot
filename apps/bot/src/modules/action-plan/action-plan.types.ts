import type { PlanAction } from '../../core/security/action-plan.policy';

/**
 * Plan d'action : les actions qui modifient, rassemblées pour n'avoir qu'une
 * seule approbation. Il vit dans la table des surfaces interactives (kind
 * `action-plan`), son statut tient dans le `kind` :
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

/** Une action écartée du plan : le demandeur ne peut pas l'exécuter, et pourquoi. */
export interface DroppedAction {
  tool: string;
  reason: string;
}

export interface ActionPlan {
  id: string;
  guildId: string;
  channelId: string;
  requesterId: string;
  /** Message du panneau ; nul tant qu'il n'est pas affiché. */
  messageId: string | null;
  actions: PlanAction[];
  /** Résumé écrit par le modèle quand le panneau se forme : il est affiché, jamais lu pour exécuter. */
  summary: string | null;
  /** Actions écartées avant affichage, parce que le demandeur ne peut pas les exécuter. */
  dropped: DroppedAction[];
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
  /** Fenêtre pendant laquelle les actions d'une même demande se regroupent. */
  stageMs: 10 * 60_000,
  /** Longueur maximale du résumé écrit par le modèle. */
  summaryMax: 600,
  /** Texte total d'un panneau : Discord refuse un message V2 à partir de 4 000 caractères, la marge couvre l'imprévu. */
  textMax: 3_900,
  /** Actions écartées listées une à une dans le panneau ; les autres sont comptées. */
  droppedShown: 3,
} as const;

/** Ce que le panneau sait de la demande, pour son résumé : le texte demandé et sa langue. */
export interface PlanRequest {
  content?: string;
  locale?: string;
}

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
