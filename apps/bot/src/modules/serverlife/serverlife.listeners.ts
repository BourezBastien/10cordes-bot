import { Listener, On } from '@spraxium/common';
import { Events, type Message, type PartialGuildMember, type GuildMember, type VoiceState } from 'discord.js';
import { PrismaService } from '../database/prisma.service';
import { ServerlifeService } from './serverlife.service';

/**
 * Listeners de la vie de serveur : capture snipe (supprimés/édités), notice
 * AFK à la mention, comptage d'activité, ré-attribution sticky roles,
 * accumulation du temps vocal. Tout est léger et fail-soft.
 */

@Listener(Events.MessageDelete)
export class SnipeDeleteListener {
  constructor(private readonly serverlife: ServerlifeService) {}

  @On()
  async onDelete(message: Message): Promise<void> {
    this.serverlife.captureSnipe(message, 'deleted');
  }
}

@Listener(Events.MessageUpdate)
export class SnipeEditListener {
  constructor(private readonly serverlife: ServerlifeService) {}

  @On()
  async onUpdate(oldMessage: Message, newMessage: Message): Promise<void> {
    this.serverlife.captureSnipe(oldMessage, 'edited', newMessage.content ?? '');
  }
}

@Listener(Events.MessageCreate)
export class ServerlifeMessageListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serverlife: ServerlifeService,
  ) {}

  @On()
  async onMessageCreate(message: Message): Promise<void> {
    if (!message.guildId) return;
    // Comptage d'activité (humains uniquement), flushé périodiquement.
    if (!message.author.bot) this.serverlife.countMessage(message.guildId, message.author.id);

    // Notice AFK : un membre mentionné est parti avec raison.
    const mentions = [...message.mentions.users.keys()].filter((id) => id !== message.author.id);
    if (mentions.length === 0) return;
    const statuses = await this.prisma.afkStatus.findMany({
      where: { guildId: message.guildId, userId: { in: mentions } },
    });
    for (const status of statuses) {
      const sinceDays = Math.max(1, Math.floor((Date.now() - status.since.getTime()) / 86_400_000));
      await message
        .reply({
          content: `💤 <@${status.userId}> est AFK depuis ${sinceDays} jour(s) : ${status.reason}`,
          allowedMentions: { users: [] },
        })
        .catch(() => {});
    }
  }
}

@Listener(Events.GuildMemberAdd)
export class StickyRolesListener {
  constructor(private readonly prisma: PrismaService) {}

  @On()
  async onMemberAdd(member: GuildMember | PartialGuildMember): Promise<void> {
    if ('guild' in member === false) return;
    const sticky = await this.prisma.stickyRole.findMany({
      where: { guildId: member.guild.id, userId: member.id },
    });
    for (const entry of sticky) {
      const role = member.guild.roles.cache.get(entry.roleId);
      if (!role) continue;
      if (!member.manageable) continue;
      await member.roles.add(role, 'sticky role (retour du membre)').catch(() => {});
    }
  }
}

@Listener(Events.VoiceStateUpdate)
export class VoiceMinutesListener {
  private readonly sessions = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  @On()
  async onVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const guildId = oldState.guild?.id ?? newState.guild?.id;
    const userId = oldState.id ?? newState.id;
    if (!guildId || !userId || newState.member?.user.bot) return;
    const key = `${guildId}:${userId}`;
    const joined = !oldState.channelId && newState.channelId;
    const left = oldState.channelId && !newState.channelId;
    if (joined) {
      this.sessions.set(key, Date.now());
      return;
    }
    if (!left) return;
    const startedAt = this.sessions.get(key);
    if (!startedAt) return;
    this.sessions.delete(key);
    const minutes = Math.round((Date.now() - startedAt) / 60_000);
    if (minutes <= 0) return;
    await this.prisma.memberActivity
      .upsert({
        where: { guildId_userId: { guildId, userId } },
        create: { guildId, userId, voiceMinutes: minutes },
        update: { voiceMinutes: { increment: minutes } },
      })
      .catch(() => {});
  }
}
