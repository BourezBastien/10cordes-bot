import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type MessageCreateOptions, type TextDisplayBuilder } from 'discord.js';
import type { PlanAction } from '../../core/security/action-plan.policy';
import { notice, panel } from '../../shared/ui';
import { PLAN_IDS, planButtonId, type ActionPlan } from './action-plan.types';

/**
 * Panneau d'un plan d'action. POO pure : un plan en, un payload Discord
 * complet (drapeau Components V2 compris), zéro appel, zéro effet de bord.
 * Le panneau en attente est le SEUL qui porte des boutons : appliquer et
 * annuler, l'identifiant du plan voyage dans leur customId.
 */

/** Longueur gardée pour les paramètres d'une action. */
const ARGS_MAX = 160;
const REASON_MAX = 200;

/** Paramètres d'une action, sur une ligne lisible : `clé=valeur, clé=valeur`. */
export function describeAction(action: PlanAction): string {
  const args = Object.entries(action.input).filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== false);
  const text = args
    .map(([key, value]) => `${key}=${String(typeof value === 'string' ? value : JSON.stringify(value)).replace(/[`\r\n]/gu, ' ')}`)
    .join(', ');
  return text.length > ARGS_MAX ? `${text.slice(0, ARGS_MAX - 3)}...` : text;
}

/** Message éphémère en Components V2. */
export type EphemeralPayload = { flags: number; components: TextDisplayBuilder[] };

export class ActionPlanPresenter {
  /** Plan en attente : demandeur, expiration, actions numérotées, deux boutons. */
  render(plan: ActionPlan): MessageCreateOptions {
    const actions = plan.actions.map((action, index) => `${index + 1}. **${action.tool}**${describeAction(action) ? ` · ${describeAction(action)}` : ''}`);
    const container = panel({
      title: '## Plan d\u0027action à approuver',
      lines: [`Demande de <@${plan.requesterId}> · Expire <t:${Math.floor(plan.expiresAt / 1000)}:R>`, ...actions],
      footer: 'Seul l\u0027auteur de la demande peut appliquer ou annuler. Chaque action est revérifiée au clic : permissions et hiérarchie.',
    });
    container.addActionRowComponents(this.buttons(plan));
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  /** Plan terminé : le résultat, plus aucun bouton. */
  renderOutcome(plan: ActionPlan): MessageCreateOptions {
    const { title, footer } = this.outcome(plan);
    const container = panel({
      title,
      lines: [`Demande de <@${plan.requesterId}>`, ...plan.actions.map((action, index) => this.outcomeLine(plan, action, index))],
      footer,
    });
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  /** Refus de la Policy (pas l'auteur, plan déjà pris) : éphémère, sans détail utile. */
  denied(message: string): EphemeralPayload {
    return notice(`🚫 ${message}`, true);
  }

  /** Accusé du clic, en éphémère : ce qui a été fait. */
  receipt(plan: ActionPlan): EphemeralPayload {
    const { title, footer } = this.outcome(plan);
    return notice(`${plan.status === 'executed' ? '✅' : plan.status === 'cancelled' ? 'ℹ️' : '⚠️'} **${title.replace(/^## /u, '')}**${footer ? `\n${footer}` : ''}`, true);
  }

  private buttons(plan: ActionPlan): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(planButtonId(PLAN_IDS.apply, plan.id)).setLabel('✅ Appliquer').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(planButtonId(PLAN_IDS.cancel, plan.id)).setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary),
    );
  }

  private outcome(plan: ActionPlan): { title: string; footer: string } {
    const total = plan.actions.length;
    const done = plan.report?.done ?? 0;
    switch (plan.status) {
      case 'executed':
        return { title: '## Plan exécuté', footer: `${total} action(s) exécutée(s).` };
      case 'interrupted': {
        // Avec l'action qui a tout arrêté quand on la connaît ; sans elle (demandeur disparu, échec imprévu), la raison seule. Jamais de « ? ».
        const reason = (plan.report?.reason ?? '').slice(0, REASON_MAX);
        const on = plan.report?.stoppedAt ? ` Arrêt sur ${plan.report.stoppedAt} :` : '';
        return { title: '## Plan interrompu', footer: `${done}/${total} action(s) exécutée(s).${on} ${reason}` };
      }
      case 'cancelled':
        return { title: '## Plan annulé', footer: 'Rien n\u0027a été exécuté.' };
      case 'expired':
        return { title: '## Plan expiré', footer: 'Le délai d\u0027approbation est dépassé, rien n\u0027a été exécuté.' };
      default:
        return { title: '## Plan en cours', footer: `${done}/${total} action(s) exécutée(s).` };
    }
  }

  /** Une action du plan terminé : exécutée, ou celle qui a tout arrêté. */
  private outcomeLine(plan: ActionPlan, action: PlanAction, index: number): string {
    const done = plan.report?.done ?? 0;
    if (index < done) return `✅ ${index + 1}. **${action.tool}**`;
    if (plan.status === 'interrupted' && index === done) {
      return `❌ ${index + 1}. **${action.tool}** : ${(plan.report?.reason ?? '').slice(0, REASON_MAX)}`;
    }
    return `${index + 1}. **${action.tool}**${plan.status === 'cancelled' || plan.status === 'expired' ? ' (non exécutée)' : ''}`;
  }
}
