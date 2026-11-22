import { Ctx } from '@spraxium/common';
import { ButtonHandler } from '@spraxium/components';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type GuildMember,
} from 'discord.js';
import { TicketsService } from './tickets.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import {
  TicketPanelButton,
  TicketClaimButton,
  TicketCloseButton,
  TicketHelpButton,
  TicketUnclaimButton,
  TicketRate1,
  TicketRate2,
  TicketRate3,
  TicketRate4,
  TicketRate5,
} from './components/ticket.components';
import { panel } from '../../shared/ui';
import { runToolAsSystem } from '../../shared/actions/run-tool';

function claimCloseRows(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('🙋 Claim').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket:unclaim').setLabel('↩️ Unclaim').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket:help').setLabel('🆘 Demander de l\u0027aide').setStyle(ButtonStyle.Primary),
  );
}

function rateRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...[1, 2, 3, 4, 5].map((rating) =>
      new ButtonBuilder().setCustomId(`ticket:rate:${rating}`).setLabel(`${rating}★`).setStyle(ButtonStyle.Secondary),
    ),
  );
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
            lines: ['Impossible de créer le ticket, vérifie la catégorie configurée.'],
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
            lines: [`Ouvert par <@${interaction.user.id}>`, 'Décris ta demande, le staff arrive !'],
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
      components: [panel({ title: '## 🙋 Ticket claimé', lines: [`Pris en charge par <@${interaction.user.id}> — masqué aux autres staff.`] })],
    });
  }
}

@ButtonHandler(TicketUnclaimButton)
export class TicketUnclaimHandler {
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

    await this.tickets.unclaim(guild.id, interaction.channelId, interaction.user.id);
    await interaction.reply({
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral],
      components: [panel({ title: '## ↩️ Ticket libéré', lines: ['De nouveau visible par tout le staff.'] })],
    });
  }
}

@ButtonHandler(TicketHelpButton)
export class TicketHelpHandler {
  constructor(private readonly config: GuildConfigService) {}

  /** Bouton visible : le membre appelle le staff sur son ticket (non éphémère). */
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    const member = interaction.member as GuildMember | null;
    if (!guild || !member || !interaction.channelId) return;
    const config = await this.config.get(guild.id).catch(() => null);
    const staffMention = config?.tickets.staffRoleId ? `<@&${config.tickets.staffRoleId}>` : 'le staff';
    await interaction.reply({
      content: `🆘 <@${member.id}> demande de l\u0027aide sur ce ticket — ${staffMention} notifié.`,
      allowedMentions: { users: [member.id], roles: config?.tickets.staffRoleId ? [config.tickets.staffRoleId] : [] },
    });
  }
}

abstract class TicketRateBase {
  constructor(protected readonly tickets: TicketsService) {}

  protected async reply(interaction: ButtonInteraction, rating: number): Promise<void> {
    const guild = interaction.guild;
    if (!guild || !interaction.channelId) return;
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const stored = await this.tickets.storeFeedback(guild.id, interaction.channelId, interaction.user.id, rating);
    const text = stored
      ? `⭐ Note enregistrée : ${rating}/5. Merci !`
      : 'Tu as déjà noté ce ticket.';
    await interaction.editReply({ content: text }).catch(() => {});
  }
}

@ButtonHandler(TicketRate1)
export class TicketRate1Handler extends TicketRateBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await this.reply(interaction, 1);
  }
}
@ButtonHandler(TicketRate2)
export class TicketRate2Handler extends TicketRateBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await this.reply(interaction, 2);
  }
}
@ButtonHandler(TicketRate3)
export class TicketRate3Handler extends TicketRateBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await this.reply(interaction, 3);
  }
}
@ButtonHandler(TicketRate4)
export class TicketRate4Handler extends TicketRateBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await this.reply(interaction, 4);
  }
}
@ButtonHandler(TicketRate5)
export class TicketRate5Handler extends TicketRateBase {
  async handle(@Ctx() interaction: ButtonInteraction): Promise<void> {
    await this.reply(interaction, 5);
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
        const textFile = new AttachmentBuilder(Buffer.from(closed.transcript, 'utf8'), {
          name: `ticket-${closed.number}-transcript.txt`,
        });
        const htmlFile = new AttachmentBuilder(Buffer.from(closed.html, 'utf8'), {
          name: `ticket-${closed.number}-transcript.html`,
        });
        const container = panel({
          title: `## 📄 Ticket #${closed.number} fermé`,
          lines: [`Ouvert par <@${closed.userId}> · Fermé par <@${interaction.user.id}>`, 'Transcripts joint (txt + HTML).'],
        });
        await logChannel
          .send({ flags: MessageFlags.IsComponentsV2, components: [container], files: [textFile, htmlFile] })
          .catch(() => {});
      }
    }

    await interaction.editReply({
      components: [
        panel({
          title: '## 🔒 Ticket fermé',
          lines: ['Transcript envoyé au staff.', 'Une note avant la suppression ? Le salon part dans 60 secondes.'],
          accentColor: 0xd9_b3_6b,
        }),
      ],
    });
    // Fenêtre de feedback : le salon reste 60s pour laisser l'ouvrier noter.
    const channelId = interaction.channelId;
    const feedbackChannel = await guild.channels.fetch(channelId).catch(() => null);
    if (feedbackChannel?.isTextBased() && !feedbackChannel.partial) {
      await feedbackChannel
        .send({
          flags: MessageFlags.IsComponentsV2,
          components: [
            panel({ title: '## ⭐ Ton avis sur ce ticket', lines: ['Une note avant la fermeture définitive ?'] }),
            rateRow(),
          ],
        })
        .catch(() => {});
    }
    // Suppression différée via le MOTEUR DE JOBS (survit aux redémarrages) :
    // l'ancien setTimeout 60 s en mémoire laissait un salon orphelin si le
    // bot redémarrant dans la fenêtre (ticket déjà closed en DB).
    void runToolAsSystem(
      'jobs.schedule',
      {
        name: `ticket-close-${channelId}`.slice(0, 60),
        kind: 'once',
        runAtIso: new Date(Date.now() + 60_000).toISOString(),
        actions: [{ type: 'runTool', name: 'deleteChannel', input: { channelId } }],
      },
      { guildId: guild.id, botUserId: interaction.client.user.id },
    ).catch(() => {});
  }
}
