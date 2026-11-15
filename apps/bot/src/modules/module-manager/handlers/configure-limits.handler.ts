import { Ctx, SlashCommandHandler, SlashIntegerOption, SlashRoleOption, SlashStringOption, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard, ValidationException } from '@spraxium/core';
import { MessageFlags, type ChatInputCommandInteraction, type Role } from 'discord.js';
import { GuildModuleStateService } from '../guild-module-state.service';
import { ModulesCommand } from '../commands/modules.command';
import { parseDurationMs } from '../../../shared/utils/duration';
import { panel } from '../../../shared/ui';

@SlashCommandHandler(ModulesCommand, { sub: 'cooldown-set', group: 'configure' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class ConfigureCooldownSetHandler {
  constructor(private readonly states: GuildModuleStateService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('module') moduleId: string,
    @SlashStringOption('duration') duration: string,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const cooldownMs = parseDurationMs(duration);
    if (cooldownMs === undefined || cooldownMs < 1_000) {
      throw new ValidationException({ field: 'duration', reason: 'Durée invalide — ex: 5s, 2m, 1h (min 1s).' });
    }
    await this.states.updateConstraints(guildId, moduleId, { cooldownMs });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Cooldown défini',
          lines: [`Module \`${moduleId}\` — ${cooldownMs}ms par utilisateur.`],
          accentColor: 0x57_f2_87,
          footer: 'Les administrateurs bypassent si admin-bypass est actif.',
        }),
      ],
    });
  }
}

@SlashCommandHandler(ModulesCommand, { sub: 'quota-set', group: 'configure' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class ConfigureQuotaSetHandler {
  constructor(private readonly states: GuildModuleStateService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('module') moduleId: string,
    @SlashRoleOption('role') role: Role | null,
    @SlashIntegerOption('max') maxActions: number | null,
    @SlashStringOption('window') window: string,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId || !role) return;
    const windowMs = parseDurationMs(window);
    if (windowMs === undefined || maxActions === null || maxActions < 1) {
      throw new ValidationException({ field: 'window', reason: 'Fenêtre ou quota invalide — ex: 30 actions / 1h.' });
    }
    const current = await this.states.getConstraints(guildId, moduleId);
    const roleQuotas = [
      ...current.roleQuotas.filter((quota) => quota.roleId !== role.id),
      { roleId: role.id, maxActions, windowMs },
    ];
    await this.states.updateConstraints(guildId, moduleId, { roleQuotas });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Quota défini',
          lines: [`<@&${role.id}> : ${maxActions} actions / ${Math.round(windowMs / 60_000)} min sur \`${moduleId}\`.`],
          accentColor: 0x57_f2_87,
          footer: 'Au-delà du quota → RateLimitException avec retry-after.',
        }),
      ],
    });
  }
}

@SlashCommandHandler(ModulesCommand, { sub: 'quota-remove', group: 'configure' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class ConfigureQuotaRemoveHandler {
  constructor(private readonly states: GuildModuleStateService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('module') moduleId: string,
    @SlashRoleOption('role') role: Role | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId || !role) return;
    const current = await this.states.getConstraints(guildId, moduleId);
    const constraints = await this.states.updateConstraints(guildId, moduleId, {
      roleQuotas: current.roleQuotas.filter((quota) => quota.roleId !== role.id),
    });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Quota retiré',
          lines: [`<@&${role.id}> n'a plus de quota sur \`${moduleId}\` (${constraints.roleQuotas.length} quota(s) restants).`],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}

@SlashCommandHandler(ModulesCommand, { sub: 'bypass-toggle', group: 'configure' })
@UseGuards(withOptions(PermissionGuard, { permissions: ['Administrator'] }))
export class ConfigureBypassToggleHandler {
  constructor(private readonly states: GuildModuleStateService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('module') moduleId: string,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const current = await this.states.getConstraints(guildId, moduleId);
    const constraints = await this.states.updateConstraints(guildId, moduleId, {
      adminBypass: !current.adminBypass,
    });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Bypass admin',
          lines: [`Module \`${moduleId}\` — bypass : **${constraints.adminBypass ? 'activé' : 'désactivé'}**`],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}
