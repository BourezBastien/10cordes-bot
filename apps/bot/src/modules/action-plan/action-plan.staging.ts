import type { ToolRunContext } from '@10cordes/shared';
import type { PlanAction } from '../../core/security/action-plan.policy';
import { PLAN_LIMITS } from './action-plan.types';

/** Actions en attente d'une même demande, avant qu'elles forment un plan. */
interface Staged {
  actions: PlanAction[];
  at: number;
}

const stageKey = (guildId: string, channelId: string, userId: string): string => `${guildId}:${userId}:${channelId}`;

/**
 * Actions mises en attente, en mémoire : une liste par demandeur et par
 * salon, qui se regroupent sur la fenêtre d'une demande. La fin de la
 * demande les retire toutes (elles forment UN plan) : rien n'attend sans
 * personne pour l'approuver.
 */
export class PlanStaging {
  private readonly staged = new Map<string, Staged>();

  /**
   * Une action rejoint la liste de la demande en cours. Null sans salon :
   * aucun plan ne peut y être affiché, la porte du registry refuse alors
   * sans promettre de panneau.
   */
  stage(ctx: ToolRunContext, tool: string, input: Record<string, unknown>): { count: number; full: boolean } | null {
    if (!ctx.guildId || !ctx.channelId) return null;
    const key = stageKey(ctx.guildId, ctx.channelId, ctx.userId);
    const found = this.staged.get(key);
    const current: Staged = found && Date.now() - found.at < PLAN_LIMITS.stageMs ? found : { actions: [], at: Date.now() };
    current.at = Date.now();
    this.staged.set(key, current);
    if (current.actions.length >= PLAN_LIMITS.maxActions) return { count: current.actions.length, full: true };
    current.actions.push({ tool, input });
    return { count: current.actions.length, full: false };
  }

  /** Retire et rend tout ce qu'un demandeur avait en attente, avec le salon du plan ; null s'il n'avait rien. */
  take(guildId: string, userId: string): { actions: PlanAction[]; channelId: string } | null {
    const prefix = `${guildId}:${userId}:`;
    const actions: PlanAction[] = [];
    let channelId = '';
    for (const [key, entry] of this.staged) {
      if (!key.startsWith(prefix)) continue;
      this.staged.delete(key);
      channelId = key.slice(prefix.length);
      actions.push(...entry.actions);
    }
    return actions.length === 0 || !channelId ? null : { actions, channelId };
  }
}
