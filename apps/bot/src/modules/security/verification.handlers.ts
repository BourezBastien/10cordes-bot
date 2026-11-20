import { Ctx } from '@spraxium/common';
import { ButtonHandler } from '@spraxium/components';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction } from 'discord.js';
import { VerificationService } from './verification.service';
import { VerifyAnswer0, VerifyAnswer1, VerifyAnswer2, VerifyGateButton } from './verification.components';

/**
 * Gate de vérification : le bouton ouvre un défi mathématique éphémère
 * (3 boutons-réponses, le bon index n'existe que côté serveur). Réussi =
 * rôle vérifié + kick annulé ; échec = on recommence.
 */

@ButtonHandler(VerifyGateButton)
export class VerifyGateHandler {
  constructor(private readonly verification: VerificationService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;
    const challenge = this.verification.createChallenge(interaction.user.id, guild.id, 5);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...challenge.labels.map((label, index) =>
        new ButtonBuilder().setCustomId(`verify:ans:${index}`).setLabel(label).setStyle(ButtonStyle.Secondary),
      ),
    );
    await interaction
      .reply({
        flags: [MessageFlags.Ephemeral],
        content: `Anti-robot : combien font **${challenge.question}** ? Clique la bonne réponse.`,
        components: [row],
      })
      .catch(() => {});
  }
}

@ButtonHandler(VerifyAnswer0)
export class VerifyAnswer0Handler {
  constructor(private readonly verification: VerificationService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const ok = await this.verification.answer(interaction.user.id, 0);
    await interaction
      .reply({
        flags: [MessageFlags.Ephemeral],
        content: ok ? '✅ Vérifié : bienvenue ! Ton accès est débloqué.' : '❌ Raté : re-clique le bouton de vérification pour un nouveau défi.',
      })
      .catch(() => {});
  }
}

@ButtonHandler(VerifyAnswer1)
export class VerifyAnswer1Handler {
  constructor(private readonly verification: VerificationService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const ok = await this.verification.answer(interaction.user.id, 1);
    await interaction
      .reply({
        flags: [MessageFlags.Ephemeral],
        content: ok ? '✅ Vérifié : bienvenue ! Ton accès est débloqué.' : '❌ Raté : re-clique le bouton de vérification pour un nouveau défi.',
      })
      .catch(() => {});
  }
}

@ButtonHandler(VerifyAnswer2)
export class VerifyAnswer2Handler {
  constructor(private readonly verification: VerificationService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const ok = await this.verification.answer(interaction.user.id, 2);
    await interaction
      .reply({
        flags: [MessageFlags.Ephemeral],
        content: ok ? '✅ Vérifié : bienvenue ! Ton accès est débloqué.' : '❌ Raté : re-clique le bouton de vérification pour un nouveau défi.',
      })
      .catch(() => {});
  }
}
