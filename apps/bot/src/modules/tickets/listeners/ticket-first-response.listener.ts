import { Listener, On } from '@spraxium/common';
import { Events, PermissionFlagsBits, type Message } from 'discord.js';
import { PrismaService } from '../../database/prisma.service';
import { GuildConfigService } from '../../guild-config/guild-config.service';
import { TicketsService } from '../tickets.service';

/**
 * Premier message d'un membre du staff dans un ticket ouvert → horodatage
 * firstResponseAt (alimente ticket.stats). Une seule écriture par ticket :
 * le filtre prisma ne matche que firstResponseAt IS NULL.
 */
@Listener(Events.MessageCreate)
export class TicketFirstResponseListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GuildConfigService,
    private readonly tickets: TicketsService,
  ) {}

  @On()
  async onMessageCreate(message: Message): Promise<void> {
    if (message.author.bot) return;
    const guildId = message.guildId;
    if (!guildId || !message.member) return;
    const ticket = await this.prisma.ticket.findFirst({
      where: { guildId, channelId: message.channelId, status: 'open', firstResponseAt: null },
      select: { id: true },
    });
    if (!ticket) return;
    const staffRoleId = (await this.config.get(guildId).catch(() => null))?.tickets.staffRoleId ?? null;
    const isStaff =
      message.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
      (staffRoleId !== null && message.member.roles.cache.has(staffRoleId));
    if (!isStaff) return;
    await this.tickets.recordFirstResponse(guildId, message.channelId);
  }
}
