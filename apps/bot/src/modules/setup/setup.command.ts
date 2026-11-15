import { Ctx, SlashCommandHandler, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { I18nService } from '@spraxium/i18n';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { buildSetupReply } from './setup.panel';
import { SetupCommand } from './setup.schema';

// Handlers : SetupHandler (dashboard) + tous les handlers des groupes
// (modules, configure, config, audit, logs, moderation, roles, tickets, agent)
// déclarés dans les modules d'origine, câblés sur SetupCommand.
@SlashCommandHandler(SetupCommand, { sub: 'dashboard' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['ManageGuild'] }))
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
