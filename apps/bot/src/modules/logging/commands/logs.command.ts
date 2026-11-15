import {
  Ctx,
  SlashCommand,
  SlashCommandHandler,
  SlashOption,
  SlashRoleOption,
  SlashSubcommand,
  UseGuards,
  withOptions,
} from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { LOG_CATEGORIES, type LogCategory } from '@10cordes/shared';
import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type Role } from 'discord.js';
import { GuildConfigService } from '../../guild-config/guild-config.service';
import { SetupCommand } from '../../setup/setup.schema';
import { panel } from '../../../shared/ui';

const CATEGORY_CHOICES = LOG_CATEGORIES.map((category) => ({ name: category, value: category }));

@SlashCommandHandler(SetupCommand, { group: 'logs', sub: 'set' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['ManageGuild'] }))
export class LogsSetHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashOption('category') category: LogCategory | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    const channelId = interaction.options.getChannel('channel', false)?.id;
    if (!guildId || !category || !channelId) return;

    await this.config.patch(guildId, { logs: { channels: { [category]: channelId } } });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## ✅ Logs routés', lines: [`**${category}** → <#${channelId}>`], accentColor: 0x57_f2_87 })],
    });
  }
}

@SlashCommandHandler(SetupCommand, { group: 'logs', sub: 'clear' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['ManageGuild'] }))
export class LogsClearHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashOption('category') category: LogCategory | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId || !category) return;

    // `null` neutralise la catégorie (retirée du document par JSON.stringify côté stockage).
    await this.config.patch(guildId, { logs: { channels: { [category]: null } } });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## ✅ Catégorie désactivée', lines: [`**${category}** n'envoie plus de logs.`], accentColor: 0x57_f2_87 })],
    });
  }
}

@SlashCommandHandler(SetupCommand, { group: 'logs', sub: 'ignore-role' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['ManageGuild'] }))
export class LogsIgnoreRoleHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashRoleOption('role') role: Role | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId || !role) return;

    const config = await this.config.get(guildId);
    const ignored = config.logs.ignoredRoles.includes(role.id)
      ? config.logs.ignoredRoles.filter((id) => id !== role.id)
      : [...config.logs.ignoredRoles, role.id];
    await this.config.patch(guildId, { logs: { ignoredRoles: ignored } });

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Exclusion de rôle',
          lines: [`<@&${role.id}> : ${ignored.includes(role.id) ? 'exclu des logs de rôles' : 'de nouveau inclus'}`],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}

@SlashCommandHandler(SetupCommand, { group: 'logs', sub: 'view' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['ManageGuild'] }))
export class LogsViewHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await this.config.get(guildId);
    const lines = LOG_CATEGORIES.map((category) => {
      const channelId = config.logs.channels[category];
      return `**${category}** : ${channelId ? `<#${channelId}>` : 'désactivé'}`;
    });
    lines.push(`**Rôles exclus** : ${config.logs.ignoredRoles.map((id) => `<@&${id}>`).join(' ') || 'aucun'}`);

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## 📜 Configuration des logs', lines })],
    });
  }
}
