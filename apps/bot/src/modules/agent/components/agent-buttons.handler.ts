import { Ctx } from '@spraxium/common';
import { ButtonHandler } from '@spraxium/components';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { AgentService } from '../agent.service';
import { AgentApproveButton, AgentCancelButton } from './agent.buttons';
import { panel } from '../../../shared/ui';

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

@ButtonHandler(AgentApproveButton)
export class AgentApproveHandler {
  constructor(private readonly agent: AgentService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    if (!guildId || !channelId) return;

    const pending = await this.agent.listPending(guildId, channelId);
    if (pending.length === 0) {
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [panel({ title: '## ⌛ Aucun plan en attente', lines: ['Le plan a déjà été traité ou a expiré.'] })],
      });
      return;
    }

    const lines: string[] = [];
    let executedCount = 0;
    let denialReason: string | undefined;
    for (const plan of pending) {
      const result = await this.agent.resolve(plan.id, interaction.user.id, 'approve');
      if (result.status === 'executed') {
        executedCount++;
        lines.push(`**« ${plan.title} » exécuté** :`);
        lines.push(...opLines(result.results));
        lines.push('');
      } else if (result.status === 'denied') {
        denialReason = result.denialReason;
        lines.push(`**« ${plan.title} » refusé**.`);
      } else if (result.status === 'expired') {
        lines.push(`**« ${plan.title} » expiré**, sans exécution.`);
      } else {
        lines.push(`**« ${plan.title} » introuvable** (déjà traité ?).`);
      }
    }
    if (lines[lines.length - 1] === '') lines.pop();

    if (executedCount === 0) {
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [panel({ title: '## 🚫 Aucun plan exécuté', lines: [denialReason ?? "Aucun plan n'a été approuvé."] })],
      });
      return;
    }

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: `## ✅ ${executedCount} plan(s) exécuté(s)`, lines })],
    });
  }
}

@ButtonHandler(AgentCancelButton)
export class AgentCancelHandler {
  constructor(private readonly agent: AgentService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    if (!guildId || !channelId) return;

    const pending = await this.agent.listPending(guildId, channelId);
    if (pending.length === 0) {
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [panel({ title: '## ⌛ Aucun plan en attente', lines: ['Rien à annuler.'] })],
      });
      return;
    }

    const cancelled: string[] = [];
    for (const plan of pending) {
      await this.agent.resolve(plan.id, interaction.user.id, 'cancel');
      cancelled.push(`« ${plan.title} »`);
    }

    const lines = [
      `Les ${cancelled.length} plan(s) suivant(s) sont annulés : **aucune action ne sera exécutée**.`,
      '',
      cancelled.map((t) => `- ${t}`).join('\n'),
    ];
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## ✖ Plans annulés', lines })],
    });
  }
}
