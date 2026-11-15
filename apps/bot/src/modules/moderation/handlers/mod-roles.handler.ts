import { Ctx, SlashCommandHandler, SlashStringOption, UseGuards } from '@spraxium/common';
import { MessageFlags, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import { ModerationService } from '../moderation.service';
import { ensureSanctionChannel, PERMS, targetMember } from './mod-shared';
import { panel } from '../../../shared/ui';
import { SetupCommand } from '../../setup/setup.schema';

@UseGuards(PERMS.roles)
export class ModDerankHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('reason') reason: string | null,
  ): Promise<void> {
    await ensureSanctionChannel(this.mod, interaction);
    const guild = interaction.guild;
    const target = targetMember(interaction);
    const me = guild?.members.me;
    if (!guild || !target || !me) throw new Error('Member not found in this server.');

    this.mod.assertHierarchy(interaction.member as GuildMember, target, me);
    const count = await this.mod.derank(target, interaction.user.id, reason);

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✂️ Membre déranké',
          lines: [
            `**${count}** rôle(s) retiré(s) à <@${target.id}>.`,
            'Un backup est stocké — restaure avec `/mod restoreroles`.',
          ],
          accentColor: 0xd9_b3_6b,
        }),
      ],
    });
  }
}

@UseGuards(PERMS.roles)
export class ModRestoreRolesHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    const target = targetMember(interaction);
    if (!guild || !target) throw new Error('Member not found in this server.');

    const restored = await this.mod.restoreRoles(target, interaction.user.id);
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: restored > 0 ? '## ✅ Rôles restaurés' : '## ℹ️ Aucun backup',
          lines:
            restored > 0
              ? [`**${restored}** rôle(s) restauré(s) à <@${target.id}>.`]
              : ['Aucun backup de rôles trouvé pour ce membre.'],
          accentColor: restored > 0 ? 0x57_f2_87 : undefined,
        }),
      ],
    });
  }
}
