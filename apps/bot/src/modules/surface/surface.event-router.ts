import { Listener, On } from '@spraxium/common';
import { Events } from 'discord.js';
import type {
  GuildMember,
  Message,
  MessageReaction,
  PartialMessage,
  PartialMessageReaction,
  PartialUser,
  User,
  VoiceState,
} from 'discord.js';
import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SurfacePipelineService, type PipelineContext, type PipelineVars, type ToolRunner } from './surface.pipeline';
import { runToolAsSystem } from '../../shared/actions/run-tool';
import { CacheStoreService } from '../../shared/cache/cache-store.service';
import { Client } from 'discord.js';
import { z } from 'zod';

/**
 * Routeur d'événements Discord → EventTriggers (la primitive qui débloque
 * anti-raid, anti-spam, ghost-ping, reaction-roles, vocaux temporaires...).
 * Events couverts : message create/delete, réactions add/remove, joins/
 * leaves, member update (rôles/pseudo/boost), voice update, channel
 * create/delete. Chaque trigger porte un filtre + une ConditionSpec + un
 * pipeline, exécuté au nom du système.
 *
 * Anti-ghost-ping : les messages avec mentions sont mis en cache TTL 60 s
 * (ICacheStore) pour être lisibles sur MessageDelete même hors cache.
 */

const EventFilterSchema = z.object({
  channelId: z.string().max(30).optional(),
  contains: z.string().max(120).optional(),
  roleId: z.string().min(15).optional(),
  hasAttachments: z.boolean().optional(),
  minMentions: z.number().int().min(1).max(30).optional(),
});

interface TriggerContextEvent {
  messageId?: string;
  channelId?: string;
  userId?: string;
  content?: string;
  roleId?: string;
  emoji?: string;
  voiceChannelId?: string;
  joined?: boolean;
  hasAttachments?: boolean;
  mentionCount?: number;
}

@Injectable()
export class EventRouterService {
  private readonly log = new Logger('EventRouter');

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: SurfacePipelineService,
    private readonly cache: CacheStoreService,
    private readonly client: Client,
    private readonly audit: AuditService,
  ) {}

  /** Dispatch un événement vers les EventTriggers armés du serveur. */
  async dispatch(event: string, guildId: string, payload: TriggerContextEvent): Promise<void> {
    try {
      const triggers = await this.prisma.eventTrigger.findMany({
        where: { guildId, event, enabled: true },
      });
      if (triggers.length === 0) return;
      const botId = this.client.user?.id ?? 'system';
      for (const trigger of triggers) {
        let filter: z.infer<typeof EventFilterSchema> = {};
        try {
          filter = EventFilterSchema.parse(JSON.parse(trigger.filter || '{}'));
        } catch {
          continue;
        }
        if (filter.channelId && filter.channelId !== payload.channelId) continue;
        if (filter.contains && !(payload.content ?? '').toLowerCase().includes(filter.contains.toLowerCase())) continue;
        if (filter.roleId && filter.roleId !== payload.roleId) continue;
        if (filter.hasAttachments && !payload.hasAttachments) continue;
        if (filter.minMentions && (payload.mentionCount ?? 0) < filter.minMentions) continue;

        const state: Record<string, unknown> = {};
        const vars: PipelineVars = {
          guildId,
          channelId: payload.channelId ?? '',
          actorId: payload.userId ?? botId,
          actorName: 'event',
          surfaceId: trigger.surfaceId ?? '',
          messageId: payload.messageId ?? null,
          state,
          steps: [],
          values: {},
          event: payload as Record<string, unknown>,
        };
        if (trigger.condition && !(await this.pipeline.evaluate(JSON.parse(trigger.condition), vars).catch(() => false))) {
          continue;
        }
        const runTool: ToolRunner = (name, input) =>
          runToolAsSystem(name, input, { guildId, botUserId: botId }).then((r) => ({ ok: r.ok, summary: r.summary }));
        const ctx: PipelineContext = { vars, member: null, runTool };
        const result = await this.pipeline.executePipeline(JSON.parse(trigger.steps) as unknown[], ctx);
        this.audit.record({
          guildId,
          source: 'agent',
          action: 'event.trigger.run',
          actorId: botId,
          metadata: { triggerId: trigger.id, event, ok: result.ok, error: result.error ?? null },
        });
      }
    } catch (error) {
      this.log.warn(`dispatch ${event} : ${(error as Error).message.slice(0, 120)}`);
    }
  }

  /** Cache ghost-ping : message avec mentions, TTL 60 s. */
  async rememberMentions(message: Message | PartialMessage): Promise<void> {
    if (!message.guildId || message.author?.bot) return;
    const content = message.content ?? '';
    const mentionCount = (content.match(/<@[!&]?\d+>/gu) ?? []).length;
    if (mentionCount === 0) return;
    await this.cache.active.set(
      `ghost:${message.id}`,
      JSON.stringify({ authorId: message.author?.id, channelId: message.channelId, content: content.slice(0, 500), mentions: content.match(/<@[!&]?\d+>/gu) ?? [] }),
      60,
    );
  }
}

// ── Listeners : événements Discord → EventRouterService.dispatch ─────

@Listener(Events.MessageCreate)
export class SurfaceEventMessageListener {
  constructor(private readonly router: EventRouterService) {}

  @On()
  async onMessageCreate(message: Message): Promise<void> {
    if (!message.guildId || message.author.bot) return;
    await this.router.rememberMentions(message);
    await this.router.dispatch('message.create', message.guildId, {
      messageId: message.id,
      channelId: message.channelId,
      userId: message.author.id,
      content: message.content.slice(0, 800),
      hasAttachments: message.attachments.size > 0,
      mentionCount: (message.content.match(/<@[!&]?\d+>/gu) ?? []).length,
    });
  }
}

@Listener(Events.MessageDelete)
export class SurfaceEventMessageDeleteListener {
  constructor(private readonly router: EventRouterService, private readonly cacheRef: CacheStoreService) {}

  @On()
  async onMessageDelete(message: Message | PartialMessage): Promise<void> {
    if (!message.guildId) return;
    // Ghost-ping : le contenu (mentions) est relu depuis le cache TTL 60 s.
    const cached = await this.cacheRef.active.get(`ghost:${message.id}`).catch(() => null);
    const info = cached ? (JSON.parse(cached) as { authorId?: string; channelId?: string; content?: string; mentions?: string[] }) : {};
    await this.router.dispatch('message.delete', message.guildId, {
      messageId: message.id,
      channelId: message.channelId ?? info.channelId,
      userId: info.authorId ?? message.author?.id,
      content: info.content ?? '',
      mentionCount: info.mentions?.length ?? 0,
    });
  }
}

@Listener(Events.MessageReactionAdd)
export class SurfaceEventReactionAddListener {
  constructor(private readonly router: EventRouterService) {}

  @On()
  async onMessageReactionAdd(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
    const guildId = reaction.message.guildId;
    if (!guildId || user.bot) return;
    await this.router.dispatch('reaction.add', guildId, {
      messageId: reaction.message.id,
      channelId: reaction.message.channelId,
      userId: user.id,
      emoji: reaction.emoji.name ?? reaction.emoji.id ?? '',
    });
  }
}

@Listener(Events.MessageReactionRemove)
export class SurfaceEventReactionRemoveListener {
  constructor(private readonly router: EventRouterService) {}

  @On()
  async onMessageReactionRemove(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
    const guildId = reaction.message.guildId;
    if (!guildId || user.bot) return;
    await this.router.dispatch('reaction.remove', guildId, {
      messageId: reaction.message.id,
      channelId: reaction.message.channelId,
      userId: user.id,
      emoji: reaction.emoji.name ?? reaction.emoji.id ?? '',
    });
  }
}

@Listener(Events.GuildMemberAdd)
export class SurfaceEventMemberJoinListener {
  constructor(private readonly router: EventRouterService) {}

  @On()
  async onGuildMemberAdd(member: GuildMember): Promise<void> {
    await this.router.dispatch('member.join', member.guild.id, { userId: member.user.id, channelId: member.guild.id });
  }
}

@Listener(Events.GuildMemberRemove)
export class SurfaceEventMemberLeaveListener {
  constructor(private readonly router: EventRouterService) {}

  @On()
  async onGuildMemberRemove(member: GuildMember | import('discord.js').PartialGuildMember): Promise<void> {
    await this.router.dispatch('member.leave', member.guild.id, { userId: member.id, channelId: member.guild.id });
  }
}

@Listener(Events.GuildMemberUpdate)
export class SurfaceEventMemberUpdateListener {
  constructor(private readonly router: EventRouterService) {}

  @On()
  async onGuildMemberUpdate(oldMember: GuildMember | import('discord.js').PartialGuildMember, newMember: GuildMember): Promise<void> {
    // Diff minimal : rôles ajoutés (boost inclus), les départs de rôle
    // suivront avec le même pattern si un cas le réclame.
    const added = [...newMember.roles.cache.keys()].filter((id) => !oldMember.roles?.cache?.has(id));
    for (const roleId of added) {
      await this.router.dispatch('member.update', newMember.guild.id, {
        userId: newMember.id,
        roleId,
        channelId: newMember.guild.id,
      });
    }
  }
}

@Listener(Events.VoiceStateUpdate)
export class SurfaceEventVoiceListener {
  constructor(private readonly router: EventRouterService) {}

  @On()
  async onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const guildId = newState.guild.id;
    const userId = newState.id;
    const before = oldState.channelId;
    const after = newState.channelId;
    if (before !== after) {
      if (after) {
        await this.router.dispatch('voice.join', guildId, { userId, channelId: after, voiceChannelId: after, joined: true });
      }
      if (before) {
        await this.router.dispatch('voice.leave', guildId, { userId, channelId: before, voiceChannelId: before, joined: false });
      }
    }
  }
}

@Listener(Events.ChannelCreate)
export class SurfaceEventChannelCreateListener {
  constructor(private readonly router: EventRouterService) {}

  @On()
  async onChannelCreate(channel: import('discord.js').NonThreadGuildBasedChannel): Promise<void> {
    await this.router.dispatch('channel.create', channel.guild.id, { channelId: channel.id });
  }
}

@Listener(Events.ChannelDelete)
export class SurfaceEventChannelDeleteListener {
  constructor(private readonly router: EventRouterService) {}

  @On()
  async onChannelDelete(channel: import('discord.js').NonThreadGuildBasedChannel): Promise<void> {
    await this.router.dispatch('channel.delete', channel.guild.id, { channelId: channel.id });
  }
}
