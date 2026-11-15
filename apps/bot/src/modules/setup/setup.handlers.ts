import { Ctx, UseGuards, withOptions } from '@spraxium/common';
import { ButtonHandler, ChannelSelectHandler, StringSelectHandler } from '@spraxium/components';
import { PermissionGuard } from '@spraxium/core';
import { I18nService } from '@spraxium/i18n';
import {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  MessageFlags,
  StringSelectMenuInteraction,
} from 'discord.js';
import { setPath } from '../../shared/utils/object';
import { SetupLanguageSelect, SetupWelcomeChannelSelect, SetupWelcomeToggle } from './setup.components';
import { buildSetupReply } from './setup.panel';
import { GuildConfigService } from '../guild-config/guild-config.service';

const MANAGE_GUILD = withOptions(PermissionGuard, { permissions: ['ManageGuild'] });

/** Helpers communs aux trois composants du /setup (mise à jour + re-rendu du panneau). */
abstract class SetupComponentHandlerBase {
  constructor(
    protected readonly config: GuildConfigService,
    protected readonly i18n: I18nService,
  ) {}

  protected async renderUpdated(
    interaction: ButtonInteraction | StringSelectMenuInteraction | ChannelSelectMenuInteraction,
    patch?: Record<string, unknown>,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const config = patch ? await this.config.patch(guildId, patch) : await this.config.get(guildId);
    const t = (key: string, vars?: Record<string, string | number>) =>
      this.i18n.tUser(interaction.user.id, key, vars, guildId);
    await interaction.update({
      ...(await buildSetupReply(config, t)),
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

@StringSelectHandler(SetupLanguageSelect)
@UseGuards(MANAGE_GUILD)
export class SetupLanguageSelectHandler extends SetupComponentHandlerBase {
  async handle(@Ctx() interaction: StringSelectMenuInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const locale = interaction.values[0] ?? 'fr';
    await this.renderUpdated(interaction, setPath('defaultLocale', locale));
  }
}

@ChannelSelectHandler(SetupWelcomeChannelSelect)
@UseGuards(MANAGE_GUILD)
export class SetupWelcomeChannelSelectHandler extends SetupComponentHandlerBase {
  async handle(@Ctx() interaction: ChannelSelectMenuInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const channelId = interaction.values[0];
    if (!channelId) return;
    await this.renderUpdated(interaction, { welcome: { channelId, enabled: true } });
  }
}

@ButtonHandler(SetupWelcomeToggle)
@UseGuards(MANAGE_GUILD)
export class SetupWelcomeToggleHandler extends SetupComponentHandlerBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const current = await this.config.get(guildId);
    await this.renderUpdated(interaction, { welcome: { enabled: !current.welcome.enabled } });
  }
}
