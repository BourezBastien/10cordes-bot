import { Ctx } from '@spraxium/common';
import { Button, ButtonHandler, ButtonParams, DynamicButtonHandler, StringSelect, StringSelectHandler } from '@spraxium/components';
import { MessageFlags, type ButtonInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { PanelsService, PanelActionButton } from './panels.service';

/**
 * Handlers des panels de l'agent : customIds hérités ('panel:btn:0..4',
 * 'panel:select') pour les définitions déjà postées, + bouton dynamique
 * natif ('panel:action', params inline r/b) pour les rangées arbitraires
 * du nouveau layout. Le panel est résolu par messageId en DB.
 */

@DynamicButtonHandler(PanelActionButton)
export class PanelActionButtonHandler {
  constructor(private readonly panels: PanelsService) {}

  async handle(
    @Ctx() interaction: ButtonInteraction,
    @ButtonParams() params: { r: number; b: number },
  ): Promise<void> {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const member = interaction.member as import('discord.js').GuildMember;
    const result = await this.panels
      .handleLayoutButton(interaction.message.id, params.r, params.b, member, interaction)
      .catch((error: unknown) => `Échec : ${error instanceof Error ? error.message.slice(0, 150) : 'erreur'}`);
    await interaction.editReply({ content: result }).catch(() => {});
  }
}

@Button({ customId: 'panel:btn:0', label: 'Option 1', style: 'primary' })
export class PanelButton0 {}

@Button({ customId: 'panel:btn:1', label: 'Option 2', style: 'primary' })
export class PanelButton1 {}

@Button({ customId: 'panel:btn:2', label: 'Option 3', style: 'primary' })
export class PanelButton2 {}

@Button({ customId: 'panel:btn:3', label: 'Option 4', style: 'primary' })
export class PanelButton3 {}

@Button({ customId: 'panel:btn:4', label: 'Option 5', style: 'primary' })
export class PanelButton4 {}

@StringSelect({ customId: 'panel:select', placeholder: 'Choisis une option' })
export class PanelSelect {}

class PanelInteractionFlow {
  constructor(private readonly panels: PanelsService) {}

  async reply(interaction: ButtonInteraction | StringSelectMenuInteraction, work: () => Promise<string>): Promise<void> {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const result = await work().catch((error: unknown) => `Échec : ${error instanceof Error ? error.message.slice(0, 150) : 'erreur'}`);
    await interaction.editReply({ content: result }).catch(() => {});
  }
}

@ButtonHandler(PanelButton0)
export class PanelButton0Handler {
  constructor(private readonly panels: PanelsService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await new PanelInteractionFlow(this.panels).reply(interaction, () => this.panels.handleButton(interaction.message.id, 0, interaction.member as import('discord.js').GuildMember));
  }
}

@ButtonHandler(PanelButton1)
export class PanelButton1Handler {
  constructor(private readonly panels: PanelsService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await new PanelInteractionFlow(this.panels).reply(interaction, () => this.panels.handleButton(interaction.message.id, 1, interaction.member as import('discord.js').GuildMember));
  }
}

@ButtonHandler(PanelButton2)
export class PanelButton2Handler {
  constructor(private readonly panels: PanelsService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await new PanelInteractionFlow(this.panels).reply(interaction, () => this.panels.handleButton(interaction.message.id, 2, interaction.member as import('discord.js').GuildMember));
  }
}

@ButtonHandler(PanelButton3)
export class PanelButton3Handler {
  constructor(private readonly panels: PanelsService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await new PanelInteractionFlow(this.panels).reply(interaction, () => this.panels.handleButton(interaction.message.id, 3, interaction.member as import('discord.js').GuildMember));
  }
}

@ButtonHandler(PanelButton4)
export class PanelButton4Handler {
  constructor(private readonly panels: PanelsService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await new PanelInteractionFlow(this.panels).reply(interaction, () => this.panels.handleButton(interaction.message.id, 4, interaction.member as import('discord.js').GuildMember));
  }
}

@StringSelectHandler(PanelSelect)
export class PanelSelectHandler {
  constructor(private readonly panels: PanelsService) {}

  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    await new PanelInteractionFlow(this.panels).reply(interaction, async () => {
      const optionIndex = Number.parseInt(interaction.values[0] ?? '0', 10) || 0;
      return this.panels.handleSelect(interaction.message.id, optionIndex, interaction.member as import('discord.js').GuildMember);
    });
  }
}
