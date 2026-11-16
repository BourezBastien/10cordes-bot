import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { PermissionFlagsBits, Client, type Guild, type GuildMember, type User } from 'discord.js';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { makeStatusTool } from '../../shared/tools/status-tool';

export interface OpenedTicket {
  channelId: string;
  number: number;
}

@Injectable()
export class TicketsService implements SpraxiumOnBoot {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GuildConfigService,
    private readonly client: Client,
    private readonly registry: ToolRegistryService,
  ) {}

  async onBoot(): Promise<void> {
    this.registry.register(
      makeStatusTool({
        name: 'getTicketSetup',
        category: 'tickets',
        description: 'Ticket system setup on this server: category, staff role, panel and logs channels.',
        summary: async (guildId) => {
          const c = await this.config.get(guildId);
          const line = (label: string, id: string | null): string =>
            `**${label}** : ${id ? `<#${id}>` : 'non configuré'}`;
          return [
            line('Catégorie', c.tickets.categoryId),
            line('Salon du panneau', c.tickets.panelChannelId),
            `**Rôle staff** : ${c.tickets.staffRoleId ? `<@&${c.tickets.staffRoleId}>` : 'non configuré'}`,
            line('Transcripts', c.tickets.logChannelId),
          ].join(' · ');
        },
      }),
    );
  }

  private async nextNumber(guildId: string): Promise<number> {
    const counter = await this.prisma.ticketCounter.upsert({
      where: { guildId },
      update: { value: { increment: 1 } },
      create: { guildId, value: 1 },
    });
    return counter.value;
  }

  isStaff(member: GuildMember, staffRoleId: string | null): boolean {
    return (
      member.permissions.has(PermissionFlagsBits.ManageGuild) ||
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      (staffRoleId !== null && member.roles.cache.has(staffRoleId))
    );
  }

  async findOpenByUser(guildId: string, userId: string) {
    return this.prisma.ticket.findFirst({
      where: { guildId, userId, status: 'open' },
    });
  }

  async findByChannel(guildId: string, channelId: string) {
    return this.prisma.ticket.findUnique({
      where: { guildId_channelId: { guildId, channelId } },
    });
  }

  async open(guild: Guild, user: User): Promise<OpenedTicket | null> {
    const config = await this.config.get(guild.id);
    const number = await this.nextNumber(guild.id);
    const me = guild.members.me;
    if (!me) return null;

    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
      },
      {
        id: me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
        ],
      },
    ];
    if (config.tickets.staffRoleId) {
      overwrites.push({
        id: config.tickets.staffRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      });
    }

    const channel = await guild.channels.create({
      name: `ticket-${String(number).padStart(4, '0')}-${user.username.slice(0, 20)}`,
      type: 0,
      parent: config.tickets.categoryId ?? undefined,
      permissionOverwrites: overwrites,
      reason: `ticket #${number} opened by <@${user.id}>`,
    });

    await this.prisma.ticket.create({
      data: { guildId: guild.id, number, channelId: channel.id, userId: user.id },
    });

    return { channelId: channel.id, number };
  }

  async claim(guildId: string, channelId: string, staffId: string): Promise<void> {
    await this.prisma.ticket.updateMany({
      where: { guildId, channelId, status: 'open' },
      data: { claimedBy: staffId },
    });
  }

  /**
   * Ferme le ticket : transcript texte complet renvoyé (à attacher au salon de logs),
   * statut passé en closed. La suppression du salon est gérée par l'appelant.
   */
  async close(guildId: string, channelId: string, closedBy: string): Promise<{ number: number; userId: string; transcript: string } | null> {
    const ticket = await this.findByChannel(guildId, channelId);
    if (!ticket || ticket.status !== 'open') return null;

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    const transcriptLines: string[] = [];
    if (channel?.isTextBased() && !channel.partial) {
      let lastId: string | undefined;
      for (let page = 0; page < 10; page++) {
        const batch = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
        if (!batch || batch.size === 0) break;
        lastId = batch.last()?.id;
        for (const message of [...batch.values()].reverse()) {
          const when = new Date(message.createdTimestamp).toISOString().slice(0, 16).replace('T', ' ');
          transcriptLines.push(`[${when}] ${message.author.username} : ${message.content || '(sans texte)'}`);
        }
        if (batch.size < 100) break;
      }
    }

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'closed', closedAt: new Date(), claimedBy: ticket.claimedBy },
    });

    const header = [
      `Transcript : ticket #${ticket.number} (serveur ${guildId})`,
      `Ouvert par : ${ticket.userId} · Fermé par : ${closedBy}`,
      ''.padEnd(60, '='),
    ];
    return {
      number: ticket.number,
      userId: ticket.userId,
      transcript: [...header, ...transcriptLines].join('\n'),
    };
  }
}
