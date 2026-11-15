import { Ctx, SlashCommandHandler, SlashStringOption, UseGuards } from '@spraxium/common';
import { MessageFlags, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import { parseDurationMs } from '../../../shared/utils/duration';
import { ModCommand } from '../commands/mod.command';
import { ModerationService } from '../moderation.service';
import { casePanel, ensureSanctionChannel, PERMS, targetMember } from './mod-shared';

@SlashCommandHandler(ModCommand, { sub: 'warn' })
@UseGuards(PERMS.warn)
export class ModWarnHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('reason') reason: string,
  ): Promise<void> {
    await ensureSanctionChannel(this.mod, interaction);
    const guild = interaction.guild;
    const target = targetMember(interaction);
    const me = guild?.members.me;
    if (!guild || !target || !me) throw new Error('Member not found in this server.');

    this.mod.assertHierarchy(interaction.member as GuildMember, target, me);
    const entry = await this.mod.warn(guild, target, interaction.user.id, reason);

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [casePanel(entry, '## ⚠️ Membre averti')],
    });
  }
}

@SlashCommandHandler(ModCommand, { sub: 'timeout' })
@UseGuards(PERMS.timeout)
export class ModTimeoutHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('duration') duration: string,
    @SlashStringOption('reason') reason: string | null,
  ): Promise<void> {
    await ensureSanctionChannel(this.mod, interaction);
    const guild = interaction.guild;
    const target = targetMember(interaction);
    const me = guild?.members.me;
    if (!guild || !target || !me) throw new Error('Member not found in this server.');

    this.mod.assertHierarchy(interaction.member as GuildMember, target, me);
    const durationMs = parseDurationMs(duration);
    if (durationMs === undefined) {
      throw new Error('Invalid duration — e.g. 10m, 1h, 3d.');
    }

    const entry = await this.mod.timeout(guild, target, interaction.user.id, durationMs, reason);
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [casePanel(entry, '## 🔇 Membre mis en timeout')],
    });
  }
}

@SlashCommandHandler(ModCommand, { sub: 'untimeout' })
@UseGuards(PERMS.timeout)
export class ModUntimeoutHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('reason') reason: string | null,
  ): Promise<void> {
    await ensureSanctionChannel(this.mod, interaction);
    const guild = interaction.guild;
    const target = targetMember(interaction);
    if (!guild || !target) throw new Error('Member not found in this server.');

    const entry = await this.mod.untimeout(guild, target, interaction.user.id, reason);
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [casePanel(entry, '## 🔊 Timeout retiré')],
    });
  }
}
