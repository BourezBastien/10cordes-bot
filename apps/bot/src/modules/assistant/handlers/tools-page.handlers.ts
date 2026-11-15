import { Button, ButtonHandler, V2Service } from '@spraxium/components';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { TOOLS_PER_PAGE, getToolsPage } from '../tools.panel';
import { ToolsListContainer } from '../v2.containers';

@Button({ customId: 'tools:nav-prev', label: '<', style: 'secondary' })
export class ToolsPrevButton {}

@Button({ customId: 'tools:nav-next', label: '>', style: 'secondary' })
export class ToolsNextButton {}

async function paginate(interaction: ButtonInteraction, delta: number, v2: V2Service): Promise<void> {
  const state = getToolsPage(interaction.message.id);
  if (!state) {
    void interaction.reply({ content: 'Panneau expiré : relance ta demande.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  const pages = Math.max(1, Math.ceil(state.tools.length / TOOLS_PER_PAGE));
  state.page = Math.min(Math.max(0, state.page + delta), pages - 1);
  const payload = await v2.buildReply(ToolsListContainer, {
    intro: state.intro ?? '',
    tools: state.tools,
    page: state.page,
  });
  await interaction.update({
    components: payload.components as never,
    flags: payload.flags as never,
  });
}

@ButtonHandler(ToolsPrevButton)
export class ToolsPrevHandler {
  constructor(private readonly v2: V2Service) {}

  async handle(interaction: ButtonInteraction): Promise<void> {
    await paginate(interaction, -1, this.v2);
  }
}

@ButtonHandler(ToolsNextButton)
export class ToolsNextHandler {
  constructor(private readonly v2: V2Service) {}

  async handle(interaction: ButtonInteraction): Promise<void> {
    await paginate(interaction, 1, this.v2);
  }
}
