import { Ctx } from '@spraxium/common';
import { ButtonHandler } from '@spraxium/components';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { AgentService } from '../agent.service';
import { AgentApproveButton, AgentCancelButton } from './agent.buttons';
import { panel } from '../../../shared/ui';

function resultLines(
  status: 'executed' | 'cancelled' | 'expired' | 'denied' | 'notfound',
  results?: Array<{ ok: boolean; label: string; detail?: string }>,
  denialReason?: string,
): { title: string; lines: string[]; accentColor?: number } {
  switch (status) {
    case 'executed':
      return {
        title: '## ✅ Plan exécuté',
        lines: (results ?? []).map((result) => `${result.ok ? '✅' : '❌'} ${result.label}${result.detail ? ` — ${result.detail}` : ''}`),
        accentColor: 0x57_f2_87,
      };
    case 'cancelled':
      return { title: '## ✖ Plan annulé', lines: ['Aucune action exécutée.'] };
    case 'expired':
      return { title: '## ⌛ Plan expiré', lines: ['Sans confirmation dans les 5 minutes, le plan est annulé.'], accentColor: 0xd9_b3_6b };
    case 'denied':
      return { title: '## 🚫 Approbation refusée', lines: [denialReason ?? "Tu n'as pas le niveau requis pour approuver ce plan."], accentColor: 0xe8_8b_94 };
    default:
      return { title: '## ❓ Plan introuvable', lines: ['Il a peut-être déjà été traité.'] };
  }
}

@ButtonHandler(AgentApproveButton)
export class AgentApproveHandler {
  constructor(private readonly agent: AgentService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;
    if (!guildId || !channelId) return;

    const pending = await this.agent.latestPending(guildId, channelId);
    if (!pending) {
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [panel({ title: '## ⌛ Aucun plan en attente', lines: ['Le plan a déjà été traité ou a expiré.'] })],
      });
      return;
    }

    const result = await this.agent.resolve(pending.id, interaction.user.id, 'approve');
    const payload = resultLines(result.status, result.results, result.denialReason);
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel(payload)],
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

    const pending = await this.agent.latestPending(guildId, channelId);
    if (!pending) {
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [panel({ title: '## ⌛ Aucun plan en attente', lines: ['Rien à annuler.'] })],
      });
      return;
    }

    const result = await this.agent.resolve(pending.id, interaction.user.id, 'cancel');
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel(resultLines(result.status))],
    });
  }
}
