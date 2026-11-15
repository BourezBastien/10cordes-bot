import { Ctx, SlashCommandHandler, SlashBooleanOption, SlashStringOption, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { ModuleScope } from '../module-manager.service';
import { ModuleManagerService } from '../module-manager.service';
import { panel } from '../../../shared/ui';
import { SetupCommand } from '../../setup/setup.schema';

@SlashCommandHandler(SetupCommand, { group: 'modules', sub: 'disable' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class ModulesDisableHandler {
  constructor(private readonly modules: ModuleManagerService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('module') moduleId: string,
    @SlashStringOption('scope') scope: string | null,
    @SlashBooleanOption('confirm') confirm: boolean | null,
  ): Promise<void> {
    const resolvedScope: ModuleScope = scope === 'global' ? 'global' : 'guild';
    const guildId = resolvedScope === 'guild' ? interaction.guildId : null;
    if (resolvedScope === 'guild' && !guildId) return;

    const result = await this.modules.disableModule(resolvedScope, guildId, moduleId, confirm ?? false);
    const targetLabel = this.modules.find(moduleId)?.label ?? moduleId;

    if (!result.applied && result.cascade && result.cascade.toDisable.length > 0) {
      const cascadeLines = [
        `Les modules suivants en dépendent et seront **désactivés** aussi :`,
        ...result.cascade.toDisable.map((id) => `🔴 **${this.modules.find(id)?.label ?? id}**`),
        ...(result.cascade.kept.length > 0
          ? [
              `Survivront (requis par un autre module actif) :`,
              ...result.cascade.kept.map((id) => `🟢 **${this.modules.find(id)?.label ?? id}**`),
            ]
          : []),
        `Relancez la commande avec \`confirm: True\` pour appliquer.`,
      ];
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [
          panel({
            title: `## ⚠️ Cascade de désactivation — ${targetLabel}`,
            lines: cascadeLines,
            accentColor: 0xd9_b3_6b,
          }),
        ],
      });
      return;
    }

    if (!result.applied) {
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [
          panel({
            title: `## ℹ️ ${targetLabel} déjà désactivé`,
            lines: ['Aucun changement appliqué.'],
          }),
        ],
      });
      return;
    }

    const lines = result.disabled.map((id) => `🔴 **${this.modules.find(id)?.label ?? id}**`);
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## 🔴 Modules désactivés',
          lines,
          accentColor: 0xe8_8b_94,
          footer: 'Leurs commandes sont immédiatement bloquées.',
        }),
      ],
    });
  }
}
