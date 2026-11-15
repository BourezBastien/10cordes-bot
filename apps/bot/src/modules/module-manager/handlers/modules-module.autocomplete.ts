import { Ctx, SlashAutocompleteHandler, SlashFocused } from '@spraxium/common';
import type { AutocompleteInteraction } from 'discord.js';
import { ModuleManagerService } from '../module-manager.service';
import { ModulesCommand } from '../commands/modules.command';

@SlashAutocompleteHandler(ModulesCommand, 'module')
export class ModulesModuleAutocomplete {
  constructor(private readonly modules: ModuleManagerService) {}

  async handle(
    @SlashFocused() focused: string | number,
    @Ctx() interaction: AutocompleteInteraction,
  ): Promise<void> {
    const query = String(focused).toLowerCase();
    const guildId = interaction.guildId;
    const modules = await this.modules.listModules(guildId);
    const results = modules
      .filter(
        (module) =>
          module.id.includes(query) ||
          module.label.toLowerCase().includes(query) ||
          module.description.toLowerCase().includes(query),
      )
      .slice(0, 25)
      .map((module) => {
        const state =
          module.guildEnabled === null
            ? module.globalEnabled
              ? 'activé'
              : 'désactivé'
            : module.globalEnabled && module.guildEnabled
              ? 'activé'
              : 'désactivé';
        return { name: `${module.label} — ${state}`, value: module.id };
      });

    await interaction.respond(results);
  }
}
