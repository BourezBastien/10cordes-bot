import { ButtonHandler, V2Service } from '@spraxium/components';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { Logger } from '@spraxium/logger';
import { notice } from '../../../shared/ui';
import { TOOLS_PER_PAGE, getToolsPage } from '../tools.panel';
import { ToolsNextButton, ToolsPrevButton } from '../tools-nav-buttons';
import { ToolsListContainer } from '../v2.containers';

const log = new Logger('ToolsPagination');

async function paginate(interaction: ButtonInteraction, delta: number, v2: V2Service): Promise<void> {
  const state = getToolsPage(interaction.message.id);
  if (!state) {
    void interaction.reply(notice('Panneau expiré : relance ta demande.', true)).catch(() => {});
    return;
  }
  try {
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
  } catch (error) {
    log.error(`Pagination échouée : ${error instanceof Error ? error.message : String(error)}`);
    // L'update peut échouer si l'interaction est déjà acquittée : reply en secours.
    await interaction
      .reply(notice(`Erreur de pagination : ${error instanceof Error ? error.message : String(error).slice(0, 120)}`, true))
      .catch(() => {});
  }
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
