import { Ctx, SlashChannelOption, SlashCommandHandler, SlashStringOption, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard, ValidationException } from '@spraxium/core';
import type { Channel, ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { GuildModuleStateService } from '../guild-module-state.service';
import { panel } from '../../../shared/ui';
import { SetupCommand } from '../../setup/setup.schema';

function guildContext(interaction: ChatInputCommandInteraction): string | null {
  return interaction.guildId;
}

@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class ConfigureViewHandler {
  constructor(private readonly states: GuildModuleStateService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('module') moduleId: string,
  ): Promise<void> {
    const guildId = guildContext(interaction);
    if (!guildId) return;
    const constraints = await this.states.getConstraints(guildId, moduleId);

    const lines = [
      `**Whitelist salons** : ${constraints.channels.length > 0 ? constraints.channels.map((id) => `<#${id}>`).join(' ') : 'tous'}`,
      `**Rôle requis** : ${constraints.requiredRoles.length > 0 ? constraints.requiredRoles.map((id) => `<@&${id}>`).join(' ') : 'aucun'}`,
      `**Cooldown utilisateur** : ${constraints.cooldownMs !== null ? `${constraints.cooldownMs}ms` : 'aucun'}`,
      `**Quotas par rôle** : ${
        constraints.roleQuotas.length > 0
          ? constraints.roleQuotas.map((q) => `<@&${q.roleId}> ${q.maxActions}/${Math.round(q.windowMs / 60_000)}min`).join(' · ')
          : 'aucun'
      }`,
      `**Users exemptés** : ${constraints.exemptUsers.length}`,
      `**Bypass admin** : ${constraints.adminBypass ? 'activé' : 'désactivé'}`,
    ];
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: `## 🔧 Contraintes — ${moduleId}`, lines })],
    });
  }
}

@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class ConfigureChannelAddHandler {
  constructor(private readonly states: GuildModuleStateService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('module') moduleId: string,
    @SlashChannelOption('channel') channel: Channel | null,
  ): Promise<void> {
    const guildId = guildContext(interaction);
    if (!guildId || !channel) return;
    const current = await this.states.getConstraints(guildId, moduleId);
    const constraints = await this.states.updateConstraints(guildId, moduleId, {
      channels: [...new Set([...current.channels, channel.id])],
    });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Whitelist salons mise à jour',
          lines: [
            `Module \`${moduleId}\` limité à ${constraints.channels.length} salon(s).`,
            constraints.channels.map((id) => `<#${id}>`).join(' '),
          ],
          accentColor: 0x57_f2_87,
          footer: 'Whitelist vide = module disponible partout.',
        }),
      ],
    });
  }
}

@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class ConfigureChannelRemoveHandler {
  constructor(private readonly states: GuildModuleStateService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('module') moduleId: string,
    @SlashChannelOption('channel') channel: Channel | null,
  ): Promise<void> {
    const guildId = guildContext(interaction);
    if (!guildId || !channel) return;
    const current = await this.states.getConstraints(guildId, moduleId);
    const constraints = await this.states.updateConstraints(guildId, moduleId, {
      channels: current.channels.filter((id) => id !== channel.id),
    });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Whitelist salons mise à jour',
          lines: [
            `Module \`${moduleId}\` limité à ${constraints.channels.length} salon(s).`,
            constraints.channels.length > 0 ? constraints.channels.map((id) => `<#${id}>`).join(' ') : 'Aucun — module disponible partout.',
          ],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}
