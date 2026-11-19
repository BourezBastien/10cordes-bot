import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { PermissionFlagsBits, Client, type Guild, type GuildMember, type User } from 'discord.js';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { makeStatusTool } from '../../shared/tools/status-tool';
import type { BotTool } from '@10cordes/shared';

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
    this.registry.register(this.ticketPriorityTool());
    this.registry.register(this.ticketStatsTool());
  }

  private ticketPriorityTool(): BotTool {
    return {
      name: 'ticket.priority',
      description: 'Change la priorité d\u0029un ticket ouvert : LOW, MEDIUM, HIGH ou URGENT.',
      category: 'tickets',
      paramsSchema: z.object({
        channelId: z.string().min(1),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Pour faire remonter un ticket urgent. Annonce la nouvelle priorité au staff dans le ticket si l\u0029utilisateur le veut.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { channelId, priority } = input as { channelId: string; priority: string };
        const updated = await this.setPriority(ctx.guildId, channelId, priority);
        return updated
          ? { ok: true, summary: `Priorité du ticket <#${channelId}> : ${priority}.` }
          : { ok: false, summary: 'Ticket ouvert introuvable sur ce salon (ou priorité inchangée).' };
      },
    };
  }

  private ticketStatsTool(): BotTool {
    return {
      name: 'ticket.stats',
      description: 'Statistiques tickets du serveur : volume fermé, temps moyen de résolution, première réponse, satisfaction.',
      category: 'tickets',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Read-only. Présente les chiffres en une phrase ou un [PANEL] si l\u0029utilisateur veut le détail.',
      handler: async (_input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const stats = await this.stats(ctx.guildId);
        const minutes = (value: number | null): string => (value === null ? 'n/a' : value < 60 ? `${value} min` : `${Math.round(value / 60)} h`);
        return {
          ok: true,
          summary:
            `Tickets fermés : ${stats.closedCount}. Résolution moyenne : ${minutes(stats.avgResolutionMinutes)}. ` +
            `Première réponse : ${minutes(stats.avgFirstResponseMinutes)}. ` +
            `Satisfaction : ${stats.avgRating ? `${stats.avgRating}/5 (${stats.feedbackCount} avis)` : 'pas encore d\u0027avis'}.`,
          data: stats,
        };
      },
    };
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
    await this.applyClaimOverwrites(guildId, channelId, staffId, true);
  }

  /**
   * Unclaim : restaure la visibilité d'origine (rôle staff re-allow, claimer
   * retiré) et libère le ticket.
   */
  async unclaim(guildId: string, channelId: string, staffId: string): Promise<void> {
    await this.prisma.ticket.updateMany({
      where: { guildId, channelId, status: 'open', claimedBy: staffId },
      data: { claimedBy: null },
    });
    await this.applyClaimOverwrites(guildId, channelId, staffId, false);
  }

  /**
   * Claim masquant (pattern discord-tickets) : le rôle staff perd ViewChannel,
   * seul le claimer le garde — le ticket devient privé au duo membre+claimer.
   */
  private async applyClaimOverwrites(
    guildId: string,
    channelId: string,
    staffId: string,
    claimed: boolean,
  ): Promise<void> {
    const guild = this.client.guilds.cache.get(guildId);
    const channel = guild ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!guild || !channel || channel.isThread()) return;
    const config = await this.config.get(guildId).catch(() => null);
    const staffRoleId = config?.tickets.staffRoleId;
    if (!staffRoleId) return;
    await channel.permissionOverwrites.edit(staffRoleId, { ViewChannel: claimed ? false : null }, { reason: `ticket claim toggle (by <@${staffId}>)` }).catch(() => {});
    await channel.permissionOverwrites.edit(staffId, { ViewChannel: claimed ? true : null }, { reason: `ticket claim toggle (by <@${staffId}>)` }).catch(() => {});
  }

  /** Premier message du staff dans le ticket : horodate une seule fois. */
  async recordFirstResponse(guildId: string, channelId: string): Promise<void> {
    await this.prisma.ticket.updateMany({
      where: { guildId, channelId, status: 'open', firstResponseAt: null },
      data: { firstResponseAt: new Date() },
    });
  }

  async setPriority(guildId: string, channelId: string, priority: string): Promise<boolean> {
    const valid = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
    if (!valid.includes(priority)) return false;
    const result = await this.prisma.ticket.updateMany({
      where: { guildId, channelId, status: 'open' },
      data: { priority },
    });
    return result.count > 0;
  }

  /** Agrégats du serveur : résolution, première réponse, satisfaction. */
  async stats(guildId: string): Promise<{
    closedCount: number;
    avgResolutionMinutes: number | null;
    avgFirstResponseMinutes: number | null;
    avgRating: number | null;
    feedbackCount: number;
  }> {
    const tickets = await this.prisma.ticket.findMany({
      where: { guildId, status: 'closed' },
      select: { createdAt: true, closedAt: true, firstResponseAt: true },
    });
    const resolutions = tickets
      .filter((t) => t.closedAt)
      .map((t) => (t.closedAt!.getTime() - t.createdAt.getTime()) / 60_000);
    const responses = tickets
      .filter((t) => t.firstResponseAt)
      .map((t) => (t.firstResponseAt!.getTime() - t.createdAt.getTime()) / 60_000);
    const feedbacks = await this.prisma.ticketFeedback.findMany({ where: { guildId }, select: { rating: true } });
    const avg = (values: number[]): number | null =>
      values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
    return {
      closedCount: tickets.length,
      avgResolutionMinutes: avg(resolutions),
      avgFirstResponseMinutes: avg(responses),
      avgRating: avg(feedbacks.map((f) => f.rating)),
      feedbackCount: feedbacks.length,
    };
  }

  /** Feedback post-fermeture (notation 1-5 par l'ouvreur avant suppression). */
  async storeFeedback(guildId: string, channelId: string, userId: string, rating: number): Promise<boolean> {
    const ticket = await this.findByChannel(guildId, channelId);
    if (!ticket) return false;
    const existing = await this.prisma.ticketFeedback.findFirst({ where: { ticketId: ticket.id, userId } });
    if (existing) return false;
    await this.prisma.ticketFeedback.create({
      data: { guildId, ticketId: ticket.id, userId, rating },
    });
    return true;
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
