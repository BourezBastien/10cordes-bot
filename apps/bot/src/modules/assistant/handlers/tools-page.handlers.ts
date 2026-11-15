import { Button, ButtonHandler } from '@spraxium/components';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { getToolsPage, renderToolsNavRow, renderToolsPanel } from '../tools.panel';

@Button({ customId: 'tools:prev', label: '⬅', style: 'secondary' })
export class ToolsPrevButton {}

@Button({ customId: 'tools:next', label: '➡', style: 'secondary' })
export class ToolsNextButton {}

function paginate(interaction: ButtonInteraction, delta: number): void {
  const state = getToolsPage(interaction.message.id);
  if (!state) {
    void interaction.reply({ content: '⌛ Panneau expiré : relance ta demande.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  const pages = Math.max(1, Math.ceil(state.tools.length / 12));
  state.page = Math.min(Math.max(0, state.page + delta), pages - 1);
  void interaction.update({
    components: [
      renderToolsPanel(state) as unknown as never,
      renderToolsNavRow(state.page > 0, state.page < pages - 1) as unknown as never,
    ],
    flags: MessageFlags.IsComponentsV2,
  });
}

@ButtonHandler(ToolsPrevButton)
export class ToolsPrevHandler {
  async handle(interaction: ButtonInteraction): Promise<void> {
    paginate(interaction, -1);
  }
}

@ButtonHandler(ToolsNextButton)
export class ToolsNextHandler {
  async handle(interaction: ButtonInteraction): Promise<void> {
    paginate(interaction, 1);
  }
}
