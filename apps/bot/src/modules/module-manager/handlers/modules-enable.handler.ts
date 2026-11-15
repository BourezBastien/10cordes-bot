import { Ctx, SlashCommandHandler, SlashStringOption, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { ModuleScope } from '../module-manager.service';
import { ModuleManagerService } from '../module-manager.service';
import { ModulesCommand } from '../commands/modules.command';
import { panel } from '../../../shared/ui';

@SlashCommandHandler(ModulesCommand, { sub: 'enable' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class ModulesEnableHandler {
  constructor(private readonly modules: ModuleManagerService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('module') moduleId: string,
    @SlashStringOption('scope') scope: string | null,
  ): Promise<void> {
    const resolvedScope: ModuleScope = scope === 'global' ? 'global' : 'guild';
    const guildId = resolvedScope === 'guild' ? interaction.guildId : null;
    if (resolvedScope === 'guild' && !guildId) return;

    const enabled = await this.modules.enableModule(resolvedScope, guildId, moduleId);
    const labels = enabled
      .map((id) => this.modules.find(id)?.label ?? id)
      .map((label) => `🟢 **${label}**`);

    const module = this.modules.find(moduleId);
    const recommended = (module?.recommends ?? []).filter((id) => !enabled.includes(id));
    const recommendLine =
      recommended.length > 0
        ? `💡 Modules conseillés (non obligatoires) : ${recommended.join(', ')}`
        : undefined;

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Modules activés',
          lines: [...labels, ...(recommendLine ? [recommendLine] : [])],
          accentColor: 0x57_f2_87,
          footer: 'Effet immédiat — les dépendances obligatoires ont été activées automatiquement.',
        }),
      ],
    });
  }
}
