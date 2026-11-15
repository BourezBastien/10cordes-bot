import { Ctx, SlashCommandHandler, SlashRoleOption, SlashStringOption, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { MessageFlags, type ChatInputCommandInteraction, type Role } from 'discord.js';
import { GuildModuleStateService } from '../guild-module-state.service';
import { panel } from '../../../shared/ui';
import { SetupCommand } from '../../setup/setup.schema';

@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class ConfigureRoleSetHandler {
  constructor(private readonly states: GuildModuleStateService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('module') moduleId: string,
    @SlashRoleOption('role') role: Role | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId || !role) return;
    const constraints = await this.states.updateConstraints(guildId, moduleId, {
      requiredRoles: [role.id],
    });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Rôle requis défini',
          lines: [`Module \`${moduleId}\` — requis : <@&${constraints.requiredRoles[0]}>`],
          accentColor: 0x57_f2_87,
          footer: 'Les membres sans ce rôle recevront une erreur de permission.',
        }),
      ],
    });
  }
}

@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class ConfigureRoleClearHandler {
  constructor(private readonly states: GuildModuleStateService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('module') moduleId: string,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    await this.states.updateConstraints(guildId, moduleId, { requiredRoles: [] });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Rôle requis retiré',
          lines: [`Module \`${moduleId}\` accessible à tous.`],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}
