import { Listener, On } from '@spraxium/common';
import {
  Events,
  type GuildBan,
  type GuildEmoji,
  type GuildMember,
  type Invite,
  type Message,
  type PartialGuildMember,
  type Role,
} from 'discord.js';
import { AuditService } from '../../audit/audit.service';

/**
 * AUDIT COMPLET (décision produit du 18/11) : chaque event Discord audible
 * est enregistré dans le journal d'audit, par défaut, sur tous les serveurs.
 * L'agent répond aux questions d'historique (« qui a banni qui ce mois-ci ? »)
 * depuis ces lignes via getAuditLogs. Désactivable plus tard par serveur.
 */

const trunc = (value: string | null | undefined, max = 150): string | undefined =>
  value === undefined || value === null ? undefined : value.slice(0, max);

/** Message create/update/delete : nourrit l'audit (contenu tronqué). */
@Listener(Events.MessageCreate)
export class AuditMessageCreatedListener {
  constructor(private readonly audit: AuditService) {}

  @On()
  onMessageCreate(message: Message): void {
    if (!message.guildId || message.author.bot) return;
    this.audit.record({
      guildId: message.guildId,
      source: 'discord',
      action: 'message.created',
      actorId: message.author.id,
      targetId: message.channelId,
      metadata: { channelId: message.channelId, content: trunc(message.content, 200) },
    });
  }
}

@Listener(Events.GuildMemberAdd)
export class AuditMemberJoinedListener {
  constructor(private readonly audit: AuditService) {}

  @On()
  onGuildMemberAdd(member: GuildMember): void {
    this.audit.record({
      guildId: member.guild.id,
      source: 'discord',
      action: 'member.joined',
      actorId: member.id,
      metadata: { username: member.user.username, count: member.guild.memberCount },
    });
  }
}

@Listener(Events.GuildMemberRemove)
export class AuditMemberLeftListener {
  constructor(private readonly audit: AuditService) {}

  @On()
  onGuildMemberRemove(member: GuildMember | PartialGuildMember): void {
    this.audit.record({
      guildId: member.guild.id,
      source: 'discord',
      action: 'member.left',
      actorId: member.id,
      metadata: { username: member.user?.username ?? '?', count: member.guild.memberCount },
    });
  }
}

@Listener(Events.GuildBanAdd)
export class AuditBanAddListener {
  constructor(private readonly audit: AuditService) {}

  @On()
  onGuildBanAdd(ban: GuildBan): void {
    this.audit.record({
      guildId: ban.guild.id,
      source: 'discord',
      action: 'ban.added',
      actorId: ban.user.id,
      metadata: { username: ban.user.username, reason: trunc(ban.reason, 200) },
    });
  }
}

@Listener(Events.GuildBanRemove)
export class AuditBanRemoveListener {
  constructor(private readonly audit: AuditService) {}

  @On()
  onGuildBanRemove(ban: GuildBan): void {
    this.audit.record({
      guildId: ban.guild.id,
      source: 'discord',
      action: 'ban.removed',
      actorId: ban.user.id,
      metadata: { username: ban.user.username },
    });
  }
}

@Listener(Events.ChannelCreate)
export class AuditChannelCreatedListener {
  constructor(private readonly audit: AuditService) {}

  @On()
  onChannelCreate(channel: import('discord.js').NonThreadGuildBasedChannel): void {
    this.audit.record({
      guildId: channel.guild.id,
      source: 'discord',
      action: 'channel.created',
      targetId: channel.id,
      metadata: { name: channel.name, type: channel.type },
    });
  }
}

@Listener(Events.ChannelDelete)
export class AuditChannelDeletedListener {
  constructor(private readonly audit: AuditService) {}

  @On()
  onChannelDelete(channel: import('discord.js').NonThreadGuildBasedChannel): void {
    this.audit.record({
      guildId: channel.guild.id,
      source: 'discord',
      action: 'channel.deleted',
      targetId: channel.id,
      metadata: { name: channel.name, type: channel.type },
    });
  }
}

@Listener(Events.GuildRoleCreate)
export class AuditRoleCreatedListener {
  constructor(private readonly audit: AuditService) {}

  @On()
  onRoleCreate(role: Role): void {
    this.audit.record({
      guildId: role.guild.id,
      source: 'discord',
      action: 'role.created',
      targetId: role.id,
      metadata: { name: role.name, color: role.color },
    });
  }
}

@Listener(Events.GuildRoleDelete)
export class AuditRoleDeletedListener {
  constructor(private readonly audit: AuditService) {}

  @On()
  onRoleDelete(role: Role): void {
    this.audit.record({
      guildId: role.guild.id,
      source: 'discord',
      action: 'role.deleted',
      targetId: role.id,
      metadata: { name: role.name },
    });
  }
}

@Listener(Events.GuildEmojiUpdate)
export class AuditEmojiUpdatedListener {
  constructor(private readonly audit: AuditService) {}

  @On()
  onGuildEmojiUpdate(oldGuildEmoji: GuildEmoji, newGuildEmoji: GuildEmoji): void {
    this.audit.record({
      guildId: newGuildEmoji.guild.id,
      source: 'discord',
      action: 'emoji.updated',
      targetId: newGuildEmoji.id,
      metadata: { before: oldGuildEmoji.name, after: newGuildEmoji.name },
    });
  }
}

@Listener(Events.InviteCreate)
export class AuditInviteCreatedListener {
  constructor(private readonly audit: AuditService) {}

  @On()
  onInviteCreate(invite: Invite): void {
    this.audit.record({
      guildId: invite.guild?.id,
      source: 'discord',
      action: 'invite.created',
      actorId: invite.inviter?.id,
      metadata: { code: invite.code, channel: invite.channel?.name, expiresAt: invite.expiresAt?.toISOString() ?? null },
    });
  }
}

@Listener(Events.InviteDelete)
export class AuditInviteDeletedListener {
  constructor(private readonly audit: AuditService) {}

  @On()
  onInviteDelete(invite: Invite): void {
    this.audit.record({
      guildId: invite.guild?.id,
      source: 'discord',
      action: 'invite.deleted',
      metadata: { code: invite.code },
    });
  }
}
