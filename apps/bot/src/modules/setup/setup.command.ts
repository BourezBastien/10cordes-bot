import { Ctx, SlashCommand, SlashCommandHandler, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { I18nService } from '@spraxium/i18n';
import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { buildSetupReply } from './setup.panel';

@SlashCommand({
  name: 'setup',
  description: 'Guided server setup — language, welcome, modules overview.',
  defaultMemberPermissions: PermissionFlagsBits.Administrator,
  dmPermission: false,
})
export class SetupCommand {
  build() {}
}

@SlashCommandHandler(SetupCommand)
@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class SetupHandler {
  constructor(
    private readonly config: GuildConfigService,
    private readonly i18n: I18nService,
  ) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await this.config.get(guildId);
    const t = this.translator(interaction, guildId);

    await interaction.reply({
      ...(await buildSetupReply(config, t)),
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
    });
  }

  private translator(interaction: ChatInputCommandInteraction, guildId: string) {
    return (key: string, vars?: Record<string, string | number>) =>
      this.i18n.tUser(interaction.user.id, key, vars, guildId);
  }
}
