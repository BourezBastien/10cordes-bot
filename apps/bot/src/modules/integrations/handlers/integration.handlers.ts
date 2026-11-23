import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { guildAdminPolicy, type GuildAccessContext } from '../../../core/security/access-policy';
import { IntegrationService } from '../integration.service';

/**
 * Handlers d'intégrations (A3) — le seul point d'entrée UI pour connecter
 * un fournisseur. Garde POO via GuildAdminPolicy (jamais de check
 * ownerId/PermissionFlagsBits inline).
 */

const INTEGRATION_LLM_BUTTON_ID = 'integration:llm:open';
const INTEGRATION_CONFIG_MODAL_ID = 'integration-config';

/** Extrait le contexte d'accès depuis une interaction Discord. */
function accessContext(
  userId: string,
  guildOwnerId: string,
  memberPermissions: import('discord.js').PermissionsBitField | null,
): GuildAccessContext {
  return {
    userId,
    guildOwnerId,
    permissions: memberPermissions ? (memberPermissions.toArray() as string[]) : [],
  };
}

/** Construit la modale de configuration d'une intégration (3 champs). */
function buildConfigModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(INTEGRATION_CONFIG_MODAL_ID).setTitle('Connecter un fournisseur IA');

  const baseUrl = new TextInputBuilder()
    .setCustomId('baseUrl')
    .setLabel('Base URL de l\u0027API (compatible OpenAI)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://api.deepseek.com ou https://openrouter.ai/api/v1')
    .setRequired(true);

  const apiKey = new TextInputBuilder()
    .setCustomId('apiKey')
    .setLabel('Clé API (chiffrée AES-256-GCM)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('sk-...')
    .setRequired(true);

  const model = new TextInputBuilder()
    .setCustomId('model')
    .setLabel('Modèle (optionnel)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('deepseek-flash, gpt-4o-mini, llama-3.1-70b...');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(baseUrl),
    new ActionRowBuilder<TextInputBuilder>().addComponents(apiKey),
    new ActionRowBuilder<TextInputBuilder>().addComponents(model),
  );
  return modal;
}

/** Bouton « Connecter un fournisseur IA » — ouvre la modale (admin only). */
export class IntegrationOpenModalButtonHandler {
  constructor(private readonly integrations: IntegrationService) {}

  async handle(interaction: import('discord.js').ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const ctx = accessContext(interaction.user.id, guild.ownerId, interaction.memberPermissions);
    if (!guildAdminPolicy.isAuthorized(ctx)) {
      await interaction
        .reply({
          flags: MessageFlags.Ephemeral,
          content: '🚫 Seul un administrateur du serveur peut configurer le fournisseur IA.',
        })
        .catch(() => {});
      return;
    }

    await interaction.showModal(buildConfigModal()).catch(() => {});
  }
}

/** Modale « integration-config » — sauvegarde la clé chiffrée (admin only). */
export class IntegrationSaveModalHandler {
  constructor(private readonly integrations: IntegrationService) {}

  async handle(interaction: import('discord.js').ModalSubmitInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const ctx = accessContext(interaction.user.id, guild.ownerId, interaction.memberPermissions);
    if (!guildAdminPolicy.isAuthorized(ctx)) {
      await interaction
        .reply({ flags: MessageFlags.Ephemeral, content: '🚫 Accès refusé.' })
        .catch(() => {});
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const baseUrl = interaction.fields.getTextInputValue('baseUrl').trim();
    const apiKey = interaction.fields.getTextInputValue('apiKey').trim();
    const model = interaction.fields.getTextInputValue('model')?.trim() ?? '';

    try {
      await this.integrations.upsert('llm', { baseUrl, apiKey, model }, interaction.user.id);
      await interaction
        .editReply({
          content: `✅ **Fournisseur IA connecté**\nBase URL : \`${baseUrl}\`\nModèle : \`${model || 'défaut du fournisseur'}\`\nLa clé est chiffrée (AES-256-GCM) et prend effet immédiatement.`,
        })
        .catch(() => {});
    } catch (error) {
      await interaction
        .editReply({
          content: `❌ Échec de la connexion : ${(error as Error).message.slice(0, 160)}`,
        })
        .catch(() => {});
    }
  }
}

/** Helper : bouton d'ouverture (utilisé par le Presenter côté AssistantService). */
export function integrationOpenButton(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(INTEGRATION_LLM_BUTTON_ID)
      .setLabel('Connecter un fournisseur IA')
      .setStyle(ButtonStyle.Primary),
  );
}
