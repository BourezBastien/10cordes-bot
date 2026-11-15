import { Ctx, SlashCommandHandler, SlashStringOption, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { ModuleManagerService } from '../module-manager.service';
import { panel } from '../../../shared/ui';
import { SetupCommand } from '../../setup/setup.schema';

@SlashCommandHandler(SetupCommand, { group: 'modules', sub: 'list' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class ModulesListHandler {
  constructor(private readonly modules: ModuleManagerService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('scope') scope: string | null,
  ): Promise<void> {
    const showGuild = scope !== 'global';
    const guildId = showGuild ? interaction.guildId : null;
    if (showGuild && !guildId) return;

    const modules = await this.modules.listModules(guildId);
    const lines = modules.map((module) => {
      const global = module.globalEnabled ? '🟢 global' : '🔴 global';
      const guild =
        module.guildEnabled === null
          ? ''
          : module.guildEnabled
            ? ' · 🟢 serveur'
            : ' · 🔴 serveur';
      const deps = module.dependsOn.length > 0 ? ` · requiert : ${module.dependsOn.join(', ')}` : '';
      return `${global}${guild} — **${module.label}** (\`${module.id}\`)${deps}`;
    });

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## 🧩 Modules',
          lines: lines.length > 0 ? lines : ['Aucun module enregistré.'],
          footer: '/modules enable|disable <module> — la désactivation liste la cascade de dépendances',
        }),
      ],
    });
  }
}
