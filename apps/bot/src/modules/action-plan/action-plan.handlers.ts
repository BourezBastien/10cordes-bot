import { Ctx } from '@spraxium/common';
import { Button, ButtonHandler } from '@spraxium/components';
import type { ButtonInteraction } from 'discord.js';
import { Logger } from '@spraxium/logger';
import { fileLog } from '../logging/file-log.service';
import { notice } from '../../shared/ui';
import { ActionPlanService } from './action-plan.service';
import { PLAN_IDS, planIdOf } from './action-plan.types';

/**
 * Boutons d'un plan d'action. Ils portent l'identifiant du plan dans leur
 * customId (`plan:apply~p=<id>`, `plan:cancel~p=<id>`) : le dispatcher route
 * sur la base, le handler relit l'identifiant. Les décorateurs de
 * `@spraxium/components` sont OBLIGATOIRES : sans eux le bouton reste muet.
 */

@Button({ customId: PLAN_IDS.apply, label: '✅ Appliquer', style: 'success' })
export class ActionPlanApplyButton {}

@Button({ customId: PLAN_IDS.cancel, label: '❌ Annuler', style: 'secondary' })
export class ActionPlanCancelButton {}

const log = new Logger('ActionPlanHandlers');

/** Un clic n'est jamais silencieux : tout échec devient un message éphémère portant la référence du clic. */
async function dispatch(plans: ActionPlanService, interaction: ButtonInteraction, action: 'apply' | 'cancel'): Promise<void> {
  const planId = planIdOf(interaction.customId);
  if (!planId) {
    await interaction.reply({ ...notice('❌ Bouton de plan sans identifiant : ce bouton vient d\u0027un ancien panneau.', true), allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }
  try {
    await plans[action](planId, interaction);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`plan ${planId} : ${action} impossible (${message.slice(0, 140)})`);
    fileLog()?.event('warn', 'action-plan', 'interaction_failed', { action, planId, interactionId: interaction.id, error: message.slice(0, 300) });
    const payload = notice(`❌ Action impossible (${message.slice(0, 200)}) [${interaction.id}]`, true);
    const reply = interaction.replied || interaction.deferred
      ? interaction.editReply({ components: payload.components }).catch(() => {})
      : interaction.reply({ ...payload, allowedMentions: { parse: [] } }).catch(() => {});
    await reply;
  }
}

@ButtonHandler(ActionPlanApplyButton)
export class ActionPlanApplyHandler {
  constructor(private readonly plans: ActionPlanService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await dispatch(this.plans, interaction, 'apply');
  }
}

@ButtonHandler(ActionPlanCancelButton)
export class ActionPlanCancelHandler {
  constructor(private readonly plans: ActionPlanService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await dispatch(this.plans, interaction, 'cancel');
  }
}
