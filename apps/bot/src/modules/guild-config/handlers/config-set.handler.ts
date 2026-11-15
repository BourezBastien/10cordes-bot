import { Ctx, SlashCommandHandler, SlashStringOption, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard, ValidationException } from '@spraxium/core';
import { CONFIG_KEYS } from '@10cordes/shared';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { ZodError } from 'zod';
import { GuildConfigService } from '../guild-config.service';
import { panel } from '../../../shared/ui';
import { getPath, setPath } from '../../../shared/utils/object';

function coerce(descriptorType: 'string' | 'boolean' | 'number' | 'channel' | 'role' | 'locale', raw: string): unknown {
  if (descriptorType === 'boolean') return raw.trim().toLowerCase() === 'true';
  if (descriptorType === 'number') return Number(raw);
  if (descriptorType === 'channel') return raw.replace(/<#(\d+)>/, '$1');
  if (descriptorType === 'role') return raw.replace(/<@&(\d+)>/, '$1');
  return raw;
}

@SlashCommandHandler(SetupCommand, { group: 'config', sub: 'set' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['ManageGuild'] }))
export class ConfigSetHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('key') key: string,
    @SlashStringOption('value') rawValue: string,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const descriptor = CONFIG_KEYS.find((entry) => entry.path === key);
    if (!descriptor) {
      throw new ValidationException({ field: 'key', reason: `Unknown config key \`${key}\`.` });
    }

    const patch = setPath(key, coerce(descriptor.type, rawValue));
    try {
      const updated = await this.config.patch(guildId, patch);
      const value = getPath(updated as unknown as Record<string, unknown>, key);
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [
          panel({
            title: '## ✅ Configuration mise à jour',
            lines: [`**\`${key}\`** → \`${JSON.stringify(value) ?? '—'}\``],
            accentColor: 0x57_f2_87,
            footer: 'Effet immédiat sur tous les modules.',
          }),
        ],
      });
    } catch (error) {
      if (error instanceof ZodError) {
        const issue = error.issues[0];
        throw new ValidationException({
          field: key,
          reason: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid value.',
        });
      }
      throw error;
    }
  }
}

import { SetupCommand } from '../../setup/setup.schema';