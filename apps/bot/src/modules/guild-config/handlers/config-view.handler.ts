import { Ctx, SlashCommandHandler, SlashStringOption, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard, ValidationException } from '@spraxium/core';
import { CONFIG_KEYS } from '@10cordes/shared';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { GuildConfigService } from '../guild-config.service';
import { ConfigCommand } from '../commands/config.command';
import { panel } from '../../../shared/ui';
import { getPath } from '../../../shared/utils/object';

@SlashCommandHandler(ConfigCommand, { sub: 'view' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['ManageGuild'] }))
export class ConfigViewHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('key') key: string | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await this.config.get(guildId);
    const source = config as unknown as Record<string, unknown>;

    if (key) {
      const descriptor = CONFIG_KEYS.find((entry) => entry.path === key);
      if (!descriptor) {
        throw new ValidationException({ field: 'key', reason: `Unknown config key \`${key}\`.` });
      }
      const value = getPath(source, key);
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [
          panel({
            title: '## ⚙️ Configuration',
            lines: [
              `**\`${key}\`** — ${descriptor.description}`,
              `Valeur actuelle : \`${JSON.stringify(value) ?? '—'}\``,
            ],
            footer: 'Modifier avec /config set',
          }),
        ],
      });
      return;
    }

    const lines = CONFIG_KEYS.map(
      (entry) => `**\`${entry.path}\`** — \`${JSON.stringify(getPath(source, entry.path))}\``,
    );
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ⚙️ Configuration du serveur',
          lines,
          footer: '/config set <key> <value> pour modifier — /config export pour transférer',
        }),
      ],
    });
  }
}
