import { Ctx } from '@spraxium/common';
import { ButtonHandler } from '@spraxium/components';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction } from 'discord.js';
import { VerificationService } from './verification.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { VerifyAnswer0, VerifyAnswer1, VerifyAnswer2, VerifyGateButton } from './verification.components';

/**
 * Gate de vérification : le bouton ouvre un défi mathématique éphémère
 * (3 boutons-réponses, le bon index n'existe que côté serveur). Réussi =
 * rôle vérifié + kick annulé ; échec = on recommence.
 */

/** Réponse au défi : les 3 handlers ne diffèrent que par l'index. */
abstract class VerifyAnswerBase {
  protected abstract readonly choiceIndex: number;

  constructor(protected readonly verification: VerificationService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const ok = guildId ? await this.verification.answer(guildId, interaction.user.id, this.choiceIndex) : false;
    await interaction
      .reply({
        flags: [MessageFlags.Ephemeral],
        content: ok ? '✅ Vérifié : bienvenue ! Ton accès est débloqué.' : '❌ Raté : re-clique le bouton de vérification pour un nouveau défi.',
      })
      .catch(() => {});
  }
}

@ButtonHandler(VerifyGateButton)
export class VerifyGateHandler {
  constructor(
    private readonly verification: VerificationService,
    private readonly config: GuildConfigService,
  ) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;
    // kickMinutes lu depuis la CONFIG du serveur (l'ancien 5 en dur
    // divergeait du délai configuré via /config).
    const config = await this.config.get(guild.id).catch(() => null);
    const kickMinutes = config?.security.kickMinutes ?? 5;
    if (kickMinutes <= 0) {
      await interaction.reply({ flags: [MessageFlags.Ephemeral], content: 'La vérification est désactivée ici.' }).catch(() => {});
      return;
    }
    const challenge = this.verification.createChallenge(interaction.user.id, guild.id, kickMinutes);
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
export class VerifyAnswer0Handler extends VerifyAnswerBase {
  protected readonly choiceIndex = 0;
}

@ButtonHandler(VerifyAnswer1)
export class VerifyAnswer1Handler extends VerifyAnswerBase {
  protected readonly choiceIndex = 1;
}

@ButtonHandler(VerifyAnswer2)
export class VerifyAnswer2Handler extends VerifyAnswerBase {
  protected readonly choiceIndex = 2;
}
