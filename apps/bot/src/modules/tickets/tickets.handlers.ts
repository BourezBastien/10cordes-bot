import { Ctx, SlashCommand, SlashCommandHandler, SlashOption, SlashSubcommand, UseGuards, withOptions } from '@spraxium/common';
import { PermissionGuard } from '@spraxium/core';
import { ButtonHandler } from '@spraxium/components';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { TicketsService } from './tickets.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { TicketPanelButton, TicketClaimButton, TicketCloseButton } from './components/ticket.components';
import { panel } from '../../shared/ui';

const ADMIN = withOptions(PermissionGuard, { permissions: ['ManageGuild'] });

function claimCloseRows(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('🙋 Claim').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
  );
}

@UseGuards(ADMIN)
export class TicketCategoryHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const categoryId = interaction.options.getChannel('channel', false)?.id;
    if (!guildId || !categoryId) return;
    await this.config.patch(guildId, { tickets: { categoryId } });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## ✅ Catégorie des tickets', lines: [`Tickets créés dans <#${categoryId}>`], accentColor: 0x57_f2_87 })],
    });
  }
}

@UseGuards(ADMIN)
export class TicketStaffHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const roleId = interaction.options.getRole('role', false)?.id;
    if (!guildId || !roleId) return;
    await this.config.patch(guildId, { tickets: { staffRoleId: roleId } });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## ✅ Rôle staff', lines: [`Staff des tickets : <@&${roleId}>`], accentColor: 0x57_f2_87 })],
    });
  }
}

@UseGuards(ADMIN)
export class TicketPanelChannelHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const channelId = interaction.options.getChannel('channel', false)?.id;
    if (!guildId || !channelId) return;
    await this.config.patch(guildId, { tickets: { panelChannelId: channelId } });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [
        panel({
          title: '## ✅ Salon du panneau',
          lines: [`Panneau postable dans <#${channelId}> — lance \`/ticket setup\`.`],
          accentColor: 0x57_f2_87,
        }),
      ],
    });
  }
}

@UseGuards(ADMIN)
export class TicketLogsHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const channelId = interaction.options.getChannel('channel', false)?.id;
    if (!guildId || !channelId) return;
    await this.config.patch(guildId, { tickets: { logChannelId: channelId } });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## ✅ Salon des transcripts', lines: [`Transcripts → <#${channelId}>`], accentColor: 0x57_f2_87 })],
    });
  }
}

@UseGuards(ADMIN)
export class TicketSetupHandler {
  constructor(private readonly config: GuildConfigService) {}

  async handle(@Ctx() interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;
    const config = await this.config.get(guildId);
    if (!config.tickets.panelChannelId) {
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [
          panel({
            title: '## ❌ Salon du panneau non configuré',
            lines: ['Lance `/ticket panel` dans le salon voulu, puis relance `/ticket setup`.'],
            accentColor: 0xe8_8b_94,
          }),
        ],
      });
      return;
    }

    const channel = await interaction.guild?.channels.fetch(config.tickets.panelChannelId).catch(() => null);
    if (!channel?.isTextBased() || channel.partial) {
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [panel({ title: '## ❌ Salon inaccessible', lines: ['Je ne peux pas écrire dans le salon du panneau.'] })],
      });
      return;
    }

    const container = panel({
      title: '## 📬 Support',
      lines: ['Un problème, une question ? Ouvre un ticket et le staff te répondra ici.'],
      footer: 'Un seul ticket ouvert à la fois par membre.',
    });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ticket:open').setLabel('📬 Ouvrir un ticket').setStyle(ButtonStyle.Primary),
    );

    await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container, row] });
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## ✅ Panneau posté', lines: [`Voir <#${channel.id}>`], accentColor: 0x57_f2_87 })],
    });
  }
}

@ButtonHandler(TicketPanelButton)
export class TicketPanelOpenHandler {
  constructor(private readonly tickets: TicketsService) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const existing = await this.tickets.findOpenByUser(guild.id, interaction.user.id);
    if (existing) {
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [
          panel({
            title: '## ℹ️ Ticket déjà ouvert',
            lines: [`Tu as déjà un ticket ouvert : <#${existing.channelId}>`],
            accentColor: 0xd9_b3_6b,
          }),
        ],
      });
      return;
    }

    const opened = await this.tickets.open(guild, interaction.user);
    if (!opened) {
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [
          panel({
            title: '## ❌ Échec',
            lines: ['Impossible de créer le ticket — vérifie la catégorie configurée.'],
            accentColor: 0xe8_8b_94,
          }),
        ],
      });
      return;
    }

    const channel = await guild.channels.fetch(opened.channelId).catch(() => null);
    if (channel?.isTextBased() && !channel.partial) {
      await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [
          panel({
            title: `## 📬 Ticket #${opened.number}`,
            lines: [`Ouvert par <@${interaction.user.id}>`, 'Décris ta demande — le staff arrive !'],
          }),
          claimCloseRows(),
        ],
      });
    }

    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## ✅ Ticket créé', lines: [`Ton ticket : <#${opened.channelId}>`], accentColor: 0x57_f2_87 })],
    });
  }
}

@ButtonHandler(TicketClaimButton)
export class TicketClaimHandler {
  constructor(
    private readonly tickets: TicketsService,
    private readonly config: GuildConfigService,
  ) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    const member = interaction.member as GuildMember | null;
    if (!guild || !member) return;
    const config = await this.config.get(guild.id);
    if (!this.tickets.isStaff(member, config.tickets.staffRoleId)) {
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [panel({ title: '## 🚫 Réservé au staff', lines: [] })],
      });
      return;
    }

    await this.tickets.claim(guild.id, interaction.channelId, interaction.user.id);
    await interaction.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [panel({ title: '## 🙋 Ticket claimé', lines: [`Pris en charge par <@${interaction.user.id}>`] })],
    });
  }
}

@ButtonHandler(TicketCloseButton)
export class TicketCloseHandler {
  constructor(
    private readonly tickets: TicketsService,
    private readonly config: GuildConfigService,
  ) {}

  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    const member = interaction.member as GuildMember | null;
    if (!guild || !member || !interaction.channelId) return;
    const config = await this.config.get(guild.id);
    if (!this.tickets.isStaff(member, config.tickets.staffRoleId)) {
      await interaction.reply({
        flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
        components: [panel({ title: '## 🚫 Réservé au staff', lines: [] })],
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const closed = await this.tickets.close(guild.id, interaction.channelId, interaction.user.id);
    if (!closed) {
      await interaction.editReply({
        components: [panel({ title: '## ℹ️ Déjà fermé', lines: ['Ce ticket est déjà fermé.'] })],
      });
      return;
    }

    if (config.tickets.logChannelId) {
      const logChannel = await guild.channels.fetch(config.tickets.logChannelId).catch(() => null);
      if (logChannel?.isTextBased() && !logChannel.partial) {
        const { AttachmentBuilder } = await import('discord.js');
        const file = new AttachmentBuilder(Buffer.from(closed.transcript, 'utf8'), {
          name: `ticket-${closed.number}-transcript.txt`,
        });
        const container = panel({
          title: `## 📄 Ticket #${closed.number} fermé`,
          lines: [`Ouvert par <@${closed.userId}> · Fermé par <@${interaction.user.id}>`, 'Transcript joint.'],
        });
        await logChannel
          .send({ flags: MessageFlags.IsComponentsV2, components: [container], files: [file] })
          .catch(() => {});
      }
    }

    await interaction.editReply({
      components: [
        panel({
          title: '## 🔒 Ticket fermé',
          lines: ['Transcript envoyé au staff.', 'Salon supprimé dans 5 secondes…'],
          accentColor: 0xd9_b3_6b,
        }),
      ],
    });
    const channelId = interaction.channelId;
    setTimeout(() => {
      void guild.channels.delete(channelId, `ticket #${closed.number} closed`).catch(() => {});
    }, 5_000);
  }
}
