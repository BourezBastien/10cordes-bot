import { Ctx, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { ButtonHandler, ModalHandler, ModalService, ModalTextField } from '@spraxium/components';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { LlmService } from '../llm.service';
import { ImagelabService } from '../../imagelab/imagelab.service';
import { AuditService } from '../../audit/audit.service';
import { panel } from '../../../shared/ui';
import { IaConfigureButton, IaConfigureModal } from '../components/ia-config.components';

const STAFF = withOptions(PermissionGuard, { permissions: ['ManageGuild'] });

/** Bouton du panneau "IA non connectée" : ouvre la modale (owner uniquement). */
@ButtonHandler(IaConfigureButton)
@UseGuards(STAFF)
export class IaConfigureButtonHandler {
  constructor(private readonly modals: ModalService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || interaction.guild.ownerId !== interaction.user.id) {
      await interaction
        .reply({ content: "🔑 Seul l'owner du serveur peut connecter le module IA.", flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }
    const modal = this.modals.build(IaConfigureModal);
    await interaction.showModal(modal);
  }
}

/** Soumission de la modale : test de connexion live, persistance, effet immédiat. */
@ModalHandler(IaConfigureModal)
export class IaConfigureModalSubmitHandler {
  constructor(
    private readonly llm: LlmService,
    private readonly imagelab: ImagelabService,
    private readonly audit: AuditService,
  ) {}

  async handle(
    @Ctx() interaction: import('discord.js').ModalSubmitInteraction,
    @ModalTextField('baseurl') baseurl: string,
    @ModalTextField('apikey') apikey: string,
    @ModalTextField('model') model: string | null,
    @ModalTextField('pixellabkey') pixellabkey: string | null,
  ): Promise<void> {
    if (!interaction.guild || interaction.guild.ownerId !== interaction.user.id) {
      await interaction
        .reply({ content: "🔑 Seul l'owner du serveur peut connecter le module IA.", flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      await this.llm.applyConfig('custom', baseurl, apikey.trim(), model?.trim() ?? '');
    } catch (error) {
      await interaction
        .editReply({
          content: `❌ Connexion IA échouée : ${error instanceof Error ? error.message : String(error)}`,
        })
        .catch(() => {});
      return;
    }

    let pixellabLine = 'Génération d\'icônes/emojis PixelLab : toujours désactivée (clé non fournie).';
    const pixellabKey = pixellabkey?.trim();
    if (pixellabKey) {
      if (/^pixl_/.test(pixellabKey)) {
        await this.imagelab.setPixellabKey(pixellabKey);
        pixellabLine = '🎨 PixelLab connecté : icônes et emojis pixel art activés.';
      } else {
        pixellabLine = '⚠️ Clé PixelLab ignorée (format attendu : pixl_...).';
      }
    }

    this.audit.record({
      guildId: interaction.guildId,
      source: 'discord',
      action: 'ia.config',
      actorId: interaction.user.id,
      metadata: { baseUrl: baseurl, model: model ?? '' },
    });

    await interaction
      .editReply({
        components: [
          panel({
            title: '## ✅ Module IA connecté',
            lines: [
              `**Base URL** : ${baseurl}`,
              `**Modèle** : ${model?.trim() || 'défaut du fournisseur'}`,
              'Test de connexion réussi, effet immédiat : mentionne-moi pour lui parler.',
              pixellabLine,
            ],
            accentColor: 0x57_f2_87,
          }),
        ],
        flags: MessageFlags.IsComponentsV2,
      })
      .catch(() => {});
  }
}
