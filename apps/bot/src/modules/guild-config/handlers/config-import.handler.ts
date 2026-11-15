import {
  Ctx,
  SlashAttachmentOption,
  SlashCommandHandler,
  UseGuards,
  withOptions,
} from '@spraxium/common';
import { PermissionGuard, ValidationException } from '@spraxium/core';
import { MessageFlags, type Attachment, type ChatInputCommandInteraction } from 'discord.js';
import { ZodError } from 'zod';
import { GuildConfigService } from '../guild-config.service';
import { panel } from '../../../shared/ui';
import { safeFetch } from '../../../shared/utils/safe-fetch';

@SlashCommandHandler(SetupCommand, { group: 'config', sub: 'import' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['ManageGuild'] }))
export class ConfigImportHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashAttachmentOption('file') file: Attachment | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    if (!file) {
      throw new ValidationException({ field: 'file', reason: 'Fichier JSON manquant.' });
    }

    let json: string;
    try {
      const response = await safeFetch(file.url);
      json = await response.text();
    } catch {
      throw new ValidationException({ field: 'file', reason: 'Fichier inaccessible — réexportez-le et réessayez.' });
    }

    try {
      const config = await this.config.importConfig(guildId, json);
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [
          panel({
            title: '## ✅ Configuration importée',
            lines: [
              `Langue par défaut : \`${config.defaultLocale}\``,
              `Welcome : ${config.welcome.enabled ? 'activé' : 'désactivé'}`,
              `Modération (derank au mute) : ${config.moderation.muteDerank ? 'oui' : 'non'}`,
              `Messages d'erreur personnalisés : ${Object.keys(config.errorMessages).length}`,
            ],
            accentColor: 0x57_f2_87,
            footer: 'Le document importé a été revalidé intégralement.',
          }),
        ],
      });
    } catch (error) {
      if (error instanceof ZodError) {
        const issue = error.issues[0];
        throw new ValidationException({
          field: 'file',
          reason: issue ? `${issue.path.join('.')}: ${issue.message}` : 'JSON invalide.',
        });
      }
      throw error;
    }
  }
}

import { SetupCommand } from '../../setup/setup.schema';