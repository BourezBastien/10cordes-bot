import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type MessageCreateOptions, type TextDisplayBuilder } from 'discord.js';
import type { PlanAction } from '../../core/security/action-plan.policy';
import { notice, panel } from '../../shared/ui';
import { v2TextLength } from '../../shared/ui/v2-text-length';
import { PLAN_IDS, PLAN_LIMITS, planButtonId, type ActionPlan, type DroppedAction } from './action-plan.types';

/**
 * Panneau d'un plan d'action. POO pure : un plan en, un payload Discord
 * complet (drapeau Components V2 compris), zéro appel, zéro effet de bord.
 * Le panneau en attente est le SEUL qui porte des boutons : appliquer et
 * annuler, l'identifiant du plan voyage dans leur customId.
 *
 * Son texte est plafonné : Discord refuse un message V2 dont les textes
 * dépassent 4 000 caractères. Le panneau se remplit par paliers ; tant qu'il
 * dépasse, on serre ce qui est secondaire (résumé, motifs d'écart,
 * paramètres), jamais la liste des actions à approuver.
 */

/** Titre du panneau en attente : le nom de la règle, tel que le staff l'active. */
export const PLAN_TITLE = '## Confirmer les actions (hors lecture)';

/** Paliers de remplissage, du plus complet au plus serré. */
type Fill = 'full' | 'short-summary' | 'no-summary' | 'count-dropped' | 'tight-args';
const FILLS: readonly Fill[] = ['full', 'short-summary', 'no-summary', 'count-dropped', 'tight-args'];

/** Longueur gardée pour les paramètres d'une action. */
const ARGS_MAX = 160;
const ARGS_TIGHT = 80;
/** Longueur gardée pour le résumé au palier resserré. */
const SUMMARY_SHORT = 300;
const REASON_MAX = 200;
const DROPPED_REASON_MAX = 100;

/** Paramètres d'une action, sur une ligne lisible : `clé=valeur, clé=valeur`. */
export function describeAction(action: PlanAction, max = ARGS_MAX): string {
  const args = Object.entries(action.input).filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== false);
  const text = args
    .map(([key, value]) => `${key}=${String(typeof value === 'string' ? value : JSON.stringify(value)).replace(/[`\r\n]/gu, ' ')}`)
    .join(', ');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** Message éphémère en Components V2. */
export type EphemeralPayload = { flags: number; components: TextDisplayBuilder[] };

export class ActionPlanPresenter {
  /** Plan en attente : demandeur, expiration, résumé, actions numérotées, actions écartées, deux boutons. */
  render(plan: ActionPlan): MessageCreateOptions {
    for (const fill of FILLS) {
      const payload = this.renderAt(plan, fill);
      if (v2TextLength(payload) <= PLAN_LIMITS.textMax) return payload;
    }
    return this.renderAt(plan, 'tight-args');
  }

  /** Rien à approuver : les actions écartées et pourquoi, sans bouton. */
  rejected(dropped: readonly DroppedAction[]): MessageCreateOptions {
    const container = panel({
      title: '## Rien à confirmer',
      lines: dropped.slice(0, PLAN_LIMITS.maxActions).map((entry) => droppedLine(entry)),
      footer: 'Aucune action n\u0027a été proposée ni exécutée. Une de ces actions te semble due : passe par le staff.',
    });
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

  private renderAt(plan: ActionPlan, fill: Fill): MessageCreateOptions {
    const argsMax = fill === 'tight-args' ? ARGS_TIGHT : ARGS_MAX;
    const actions = plan.actions.map((action, index) => {
      const args = describeAction(action, argsMax);
      return `${index + 1}. **${action.tool}**${args ? ` · ${args}` : ''}`;
    });
    // Le résumé du modèle est déjà nettoyé et plafonné : le palier le raccourcit encore ou le retire.
    const summary = (plan.summary ?? '').slice(0, fill === 'short-summary' ? SUMMARY_SHORT : PLAN_LIMITS.summaryMax).trimEnd();
    const hidden = fill === 'no-summary' || fill === 'count-dropped' || fill === 'tight-args';
    const container = panel({
      title: PLAN_TITLE,
      lines: [
        `Demande de <@${plan.requesterId}> · Expire <t:${Math.floor(plan.expiresAt / 1000)}:R>`,
        ...(summary && !hidden ? [summary] : []),
        ...actions,
        ...this.droppedLines(plan.dropped, fill),
      ],
      footer: 'Seul l\u0027auteur de la demande peut appliquer ou annuler. Chaque action est revérifiée au clic : permissions et hiérarchie.',
    });
    container.addActionRowComponents(this.buttons(plan));
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  /** Actions écartées avant affichage : au plus trois détaillées, les autres comptées ; un seul compte aux paliers serrés. */
  private droppedLines(dropped: readonly DroppedAction[], fill: Fill): string[] {
    if (dropped.length === 0) return [];
    if (fill === 'count-dropped' || fill === 'tight-args') {
      return [`-# ${dropped.length} action(s) écartée(s) : le demandeur ne peut pas les exécuter.`];
    }
    const shown = dropped.slice(0, PLAN_LIMITS.droppedShown).map(droppedLine);
    const rest = dropped.length - shown.length;
    return rest > 0 ? [...shown, `-# … et ${rest} autre(s) action(s) écartée(s).`] : shown;
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

/** Une action écartée, en sous-texte : l'outil et la raison, sans en faire une ligne d'action. */
function droppedLine(entry: DroppedAction): string {
  return `-# Écartée (le demandeur ne peut pas l\u0027exécuter) : **${entry.tool}** · ${entry.reason.slice(0, DROPPED_REASON_MAX)}`;
}
