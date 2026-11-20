import type { ComponentButtonAction } from '@10cordes/shared';
import type { ButtonInteraction, StringSelectMenuInteraction, GuildMember } from 'discord.js';

/**
 * Registre d'actions génériques des composants construits par l'agent.
 * Un bouton/sélecteur porte une `ComponentButtonAction` (schéma Zod partagé)
 * ; l'exécution est dispatchée vers l'executor enregistré pour son `type`.
 * Les executors sont enregistrés par les modules propriétaires de la logique
 * (ex : 'ticket' par panels.service, 'counter' par records.service) — zéro
 * couplage circulaire.
 */

export interface ComponentActionContext {
  interaction: ButtonInteraction | StringSelectMenuInteraction;
  guildId: string;
  channelId: string;
  member: GuildMember | null;
  /** Id du message porteur (AgentPanel.messageId) pour la persistance. */
  messageId: string;
  /** Label du bouton/option déclencheur (pour les tickets : nom du salon). */
  label?: string;
}

type ActionExecutor = (action: ComponentButtonAction, ctx: ComponentActionContext) => Promise<string>;

const executors = new Map<string, ActionExecutor>();

/** Enregistre (ou remplace) l'executor d'un type d'action. */
export function registerComponentAction(type: ComponentButtonAction['type'], executor: ActionExecutor): void {
  executors.set(type, executor);
}

/** Dispatch une action vers son executor. Retourne le texte de confirmation. */
export async function executeComponentAction(
  action: ComponentButtonAction,
  ctx: ComponentActionContext,
): Promise<string> {
  const executor = executors.get(action.type);
  if (!executor) return `Action « ${action.type} » non gérée par le bot.`;
  return executor(action, ctx);
}
