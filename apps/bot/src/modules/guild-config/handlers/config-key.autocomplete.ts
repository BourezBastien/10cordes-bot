import { Ctx, SlashAutocompleteHandler, SlashFocused } from '@spraxium/common';
import { CONFIG_KEYS } from '@10cordes/shared';
import type { AutocompleteInteraction } from 'discord.js';
import { ConfigCommand } from '../commands/config.command';

@SlashAutocompleteHandler(ConfigCommand, 'key')
export class ConfigKeyAutocomplete {
  async handle(
    @SlashFocused() focused: string | number,
    @Ctx() interaction: AutocompleteInteraction,
  ): Promise<void> {
    const query = String(focused).toLowerCase();
    const options = CONFIG_KEYS.filter(
      (entry) => entry.path.includes(query) || entry.description.toLowerCase().includes(query),
    )
      .slice(0, 25)
      .map((entry) => ({ name: `${entry.path} — ${entry.description}`, value: entry.path }));
    await interaction.respond(options);
  }
}
