import { Ctx, SlashCommandHandler, SlashIntegerOption, SlashStringOption, UseGuards } from '@spraxium/common';
import { MessageFlags, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import { ModerationService } from '../moderation.service';
import { casePanel, ensureSanctionChannel, PERMS } from './mod-shared';
import { panel } from '../../../shared/ui';
import { SetupCommand } from '../../setup/setup.schema';

@UseGuards(PERMS.kick)
export class ModKickHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('reason') reason: string | null,
  ): Promise<void> {
    await ensureSanctionChannel(this.mod, interaction);
    const guild = interaction.guild;
    const target = (interaction.options.getMember('user') as GuildMember | null) ?? null;
    const me = guild?.members.me;
    if (!guild || !target || !me) throw new Error('Member not found in this server.');

    this.mod.assertHierarchy(interaction.member as GuildMember, target, me);
    const entry = await this.mod.kick(guild, target, interaction.user.id, reason);

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [casePanel(entry, '## 👢 Membre expulsé')],
    });
  }
}

@UseGuards(PERMS.ban)
export class ModBanHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('reason') reason: string | null,
  ): Promise<void> {
    await ensureSanctionChannel(this.mod, interaction);
    const guild = interaction.guild;
    const targetUser = interaction.options.getUser('user', false);
    if (!guild || !targetUser) throw new Error('User not found.');

    const targetMemberCached = guild.members.cache.get(targetUser.id) ?? null;
    const me = guild.members.me;
    if (targetMemberCached && me) {
      this.mod.assertHierarchy(interaction.member as GuildMember, targetMemberCached, me);
    }

    const purgeMessages = interaction.options.getBoolean('purge_messages', false) ?? false;
    const entry = await this.mod.ban(guild, targetUser, interaction.user.id, reason, purgeMessages);

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [casePanel(entry, '## ⛔ Utilisateur banni')],
    });
  }
}

@UseGuards(PERMS.ban)
export class ModUnbanHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashStringOption('user_id') userId: string,
    @SlashStringOption('reason') reason: string | null,
  ): Promise<void> {
    await ensureSanctionChannel(this.mod, interaction);
    const guild = interaction.guild;
    if (!guild) return;

    await this.mod.unban(guild, userId, interaction.user.id, reason);
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Utilisateur débanni',
          lines: [`<@${userId}> peut rejoindre le serveur.`],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}

@UseGuards(PERMS.purge)
export class ModPurgeHandler {
  constructor(private readonly mod: ModerationService) {}

  async handle(
    @Ctx() interaction: ChatInputCommandInteraction,
    @SlashIntegerOption('count') count: number | null,
  ): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId || count === null) return;
    const filteredUserId = interaction.options.getUser('user', false)?.id;

    const deleted = await this.mod.purge(
      interaction.channelId,
      guildId,
      interaction.user.id,
      count,
      filteredUserId,
    );
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## 🧹 Purge terminée',
          lines: [`**${deleted}** message(s) supprimé(s)${filteredUserId ? ` de <@${filteredUserId}>` : ''}.`],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}
