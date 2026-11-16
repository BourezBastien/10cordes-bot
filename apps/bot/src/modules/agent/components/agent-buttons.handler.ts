import { Ctx } from '@spraxium/common';
import { ButtonHandler } from '@spraxium/components';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { AgentService } from '../agent.service';
import { AgentApproveButton, AgentCancelButton } from './agent.buttons';
import { panel } from '../../../shared/ui';
import { deleteAnswer } from '../../assistant/handlers/answer-view.handler';

interface OpResult {
  ok: boolean;
  label: string;
  detail?: string;
}

function opLines(results?: OpResult[]): string[] {
  return (results ?? []).map(
    (result) => `${result.ok ? '✅' : '❌'} ${result.label}${result.detail ? ` (${result.detail})` : ''}`,
  );
}

/**
 * Résout TOUS les plans en attente du salon. L'interaction est DEFER tout de
 * suite (token étendu à 15 min) : exécuter plusieurs plans dépasse largement
 * les 3 secondes de fenêtre de première réponse (crash "Unknown interaction").
 * Les portails des plans traités sont supprimés du salon.
 */
async function resolveAllPending(
  agent: AgentService,
  interaction: ButtonInteraction,
  action: 'approve' | 'cancel',
): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId || !channelId) return;

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const pending = await agent.listPending(guildId, channelId);
  if (pending.length === 0) {
    await interaction.editReply({
      components: [panel({ title: '## ⌛ Aucun plan en attente', lines: ['Le plan a déjà été traité ou a expiré.'] })],
    });
    return;
  }

  const lines: string[] = [];
  const portalsToDelete: string[] = [];
  let executedCount = 0;
  let denialReason: string | undefined;

  for (const plan of pending) {
    const result = await agent.resolve(plan.id, interaction.user.id, action);
    const title = result.planTitle ?? plan.title;
    if (result.panelMessageId) portalsToDelete.push(result.panelMessageId);

    if (result.status === 'executed') {
      executedCount++;
      lines.push(`**« ${title} » exécuté** :`);
      lines.push(...opLines(result.results));
      lines.push('');
    } else if (result.status === 'cancelled') {
      lines.push(`**« ${title} » annulé** : aucune action exécutée.`);
    } else if (result.status === 'denied') {
      denialReason = result.denialReason;
      lines.push(`**« ${title} » refusé**.`);
    } else if (result.status === 'expired') {
      lines.push(`**« ${title} » expiré**, sans exécution.`);
    } else {
      lines.push(`**« ${title} » introuvable** (déjà traité ?).`);
    }
  }
  if (lines[lines.length - 1] === '') lines.pop();

  // Portails + panneaux supprimés : plus aucune trace de demande traitée.
  const channel = interaction.channel;
  for (const messageId of portalsToDelete) {
    await channel?.messages.delete(messageId).catch(() => {});
    deleteAnswer(messageId);
  }

  let payload: { title: string; lines: string[]; accentColor?: number };
  if (action === 'cancel') {
    payload = { title: '## ✖ Plans annulés', lines: [`Les plans suivants sont annulés, **aucune action n'a été exécutée** :`, '', ...lines] };
  } else if (executedCount === 0) {
    payload = { title: '## 🚫 Aucun plan exécuté', lines: [denialReason ?? "Aucun plan n'a été approuvé."], accentColor: 0xe8_8b_94 };
  } else {
    payload = { title: `## ✅ ${executedCount} plan(s) exécuté(s)`, lines, accentColor: 0x57_f2_87 };
  }

  await interaction.editReply({ components: [panel(payload)] });
}

@ButtonHandler(AgentApproveButton)
export class AgentApproveHandler {
  constructor(private readonly agent: AgentService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await resolveAllPending(this.agent, interaction, 'approve');
  }
}

@ButtonHandler(AgentCancelButton)
export class AgentCancelHandler {
  constructor(private readonly agent: AgentService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await resolveAllPending(this.agent, interaction, 'cancel');
  }
}
