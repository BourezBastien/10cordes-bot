import { Ctx, SlashCommandHandler, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { AttachmentBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { GuildConfigService } from '../guild-config.service';
import { ConfigCommand } from '../commands/config.command';
import { fileComponent, panel } from '../../../shared/ui';

@SlashCommandHandler(ConfigCommand, { sub: 'export' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['ManageGuild'] }))
export class ConfigExportHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const json = await this.config.exportConfig(guildId);
    const fileName = `config-${guildId}.json`;
    const attachment = new AttachmentBuilder(Buffer.from(json, 'utf8'), { name: fileName });

    const container = panel({
      title: '## 📤 Configuration exportée',
      lines: [`Serveur \`${guildId}\``, 'Réimportez ce fichier sur un autre serveur avec `/config import`.'],
      footer: 'Le fichier contient la configuration complète, validée au format actuel.',
    });
    container.addFileComponents(fileComponent(fileName));

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      files: [attachment],
      components: [container],
    });
  }
}
