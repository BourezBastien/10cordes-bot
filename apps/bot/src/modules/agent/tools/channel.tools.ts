import { ChannelType, type GuildChannel } from 'discord.js';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { botPermissionPolicy } from '../../../core/security/bot-permission.policy';
import { isAssignablePermissionName } from '../../../core/security/permission-name';
import type { DiscordToolContext } from './tool-context';
import { agentReason } from './tool-context';
import { withPreState } from './tool-support';

/** Tools de gestion des salons et catégories : création, réglages, placement, overwrites. */
export function channelTools(toolCtx: DiscordToolContext): BotTool[] {
  const { guildOf, noGuild } = toolCtx;

  return [
    {
      name: 'createChannel',
      description: 'Crée un salon texte, vocal ou une catégorie, avec placement optionnel (catégorie parente, position).',
      category: 'agent',
      paramsSchema: z.object({
        name: z.string().min(1).max(100),
        kind: z.enum(['text', 'voice', 'category']).default('text'),
        topic: z.string().max(1024).optional(),
        categoryId: z.string().min(1).optional(),
        position: z.number().int().min(1).max(100).optional(),
        userLimit: z.number().int().min(1).max(99).optional().describe('kind=voice : limite de places (générateurs "Duo"=2, "Squad"=5...)'),
      }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt:
        'Tier 2 (reversible). Call getServerStyle FIRST and imitate the detected conventions (emoji prefixes, special casing) before naming. Place with categoryId; position = slot in the list (1 = top).',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { name, kind, topic, categoryId, position, userLimit } = input as {
          name: string;
          kind: 'text' | 'voice' | 'category';
          topic?: string;
          categoryId?: string;
          position?: number;
          userLimit?: number;
        };
        if (!botPermissionPolicy.canInGuild(guild, 'ManageChannels')) {
          return { ok: false, summary: botPermissionPolicy.refusal('ManageChannels') };
        }
        const created = await guild.channels.create({
          name,
          type: kind === 'voice' ? ChannelType.GuildVoice : kind === 'category' ? ChannelType.GuildCategory : ChannelType.GuildText,
          topic,
          parent: categoryId,
          ...(kind === 'voice' && userLimit ? { userLimit } : {}),
          reason: agentReason(ctx),
        });
        if (position !== undefined) {
          await created.setPosition(position, { reason: agentReason(ctx) }).catch(() => {});
        }
        const placed = categoryId ? ` dans <#${categoryId}>` : '';
        return {
          ok: true,
          summary: `Salon **${name}** créé${placed} → <#${created.id}>`,
          data: { channelId: created.id },
        };
      },
    },
    {
      name: 'setChannelPosition',
      description: 'Déplace un salon dans la liste (position 1 = tout en haut), la primitive « remonte le salon urgent en haut de la catégorie ».',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), position: z.number().int().min(1).max(500) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). Position = slot dans la liste, 1 = sommet. Rate-limit Discord : regroupe les déplacements.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, position } = input as { channelId: string; position: number };
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !('setPosition' in channel)) return { ok: false, summary: 'Salon introuvable.' };
        const moved = await channel
          .setPosition(position, { reason: agentReason(ctx) })
          .then(() => true)
          .catch(() => false);
        return moved
          ? { ok: true, summary: `Salon <#${channelId}> déplacé à la position ${position}.` }
          : { ok: false, summary: 'Déplacement impossible (permissions ou rate-limit).' };
      },
    },
    {
      name: 'renameChannel',
      description: 'Renomme un salon.',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), name: z.string().min(1).max(100) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). Requires bot ManageChannels. Resolve the channel via channel.list first, never guess IDs.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, name } = input as { channelId: string; name: string };
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !('setName' in channel)) return { ok: false, summary: 'Salon introuvable.' };
        if (!botPermissionPolicy.canInGuild(guild, 'ManageChannels')) {
          return { ok: false, summary: botPermissionPolicy.refusal('ManageChannels') };
        }
        const oldName = channel.name;
        await channel.setName(name, agentReason(ctx));
        return { ok: true, summary: `Salon renommé en **${name}**.`, data: { preState: { channelId: channel.id, oldName } } };
      },
    },
    {
      name: 'archiveChannel',
      description: 'Archive un salon : renommé `archive-…`, contenu conservé (aucune suppression).',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt:
        'Preferred over deletion. Reversible. Requires bot ManageChannels. Explain to the user that nothing is deleted.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId } = input as { channelId: string };
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !('setName' in channel)) return { ok: false, summary: 'Salon introuvable.' };
        if (!botPermissionPolicy.canInGuild(guild, 'ManageChannels')) {
          return { ok: false, summary: botPermissionPolicy.refusal('ManageChannels') };
        }
        await channel.setName(`archive-${channel.name}`, agentReason(ctx));
        return { ok: true, summary: `Salon archivé : **archive-${channel.name}**.` };
      },
    },
    {
      name: 'setChannelTopic',
      description: "Change le sujet (topic) d'un salon texte.",
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), topic: z.string().max(1024) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). Resolve the channel via channel.list first.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, topic } = input as { channelId: string; topic: string };
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !('setTopic' in channel)) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
        const textChannel = channel as GuildChannel & { setTopic: (topic: string, reason: string) => Promise<unknown>; topic?: string | null };
        const oldTopic = textChannel.topic ?? '';
        await textChannel.setTopic(topic, agentReason(ctx));
        return withPreState({ ok: true, summary: `Topic de <#${channel.id}> mis à jour.` }, { channelId: channel.id, oldTopic });
      },
    },
    {
      name: 'setChannelSlowmode',
      description: "Définit le mode lent d'un salon (0 = off, max 6h).",
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), seconds: z.number().int().min(0).max(21600) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). 0 désactive le mode lent.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, seconds } = input as { channelId: string; seconds: number };
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !('setRateLimitPerUser' in channel)) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
        const textChannel = channel as GuildChannel & {
          setRateLimitPerUser: (seconds: number, reason: string) => Promise<unknown>;
          rateLimitPerUser: number;
        };
        const oldSlowmode = textChannel.rateLimitPerUser;
        await textChannel.setRateLimitPerUser(seconds, agentReason(ctx));
        return withPreState({ ok: true, summary: `Mode lent de <#${channel.id}> : ${seconds}s.` }, { channelId: channel.id, oldSlowmode });
      },
    },
    {
      name: 'setChannelOverwrite',
      description:
        "Définit les permissions d'un rôle sur un salon ou une catégorie (listes allow/deny de flags Discord). roleId = id du serveur pour @everyone.",
      category: 'agent',
      paramsSchema: z.object({
        channelId: z.string().min(1),
        roleId: z.string().min(1),
        allow: z.array(z.string()).max(30).default([]),
        deny: z.array(z.string()).max(30).default([]),
      }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: false,
      systemPrompt:
        "Tier 2 (reversible). Restricting access pattern: deny ['ViewChannel','Connect'] on @everyone (roleId = the GUILD id), then allow ['ViewChannel','Connect'] on each target role. Resolve role ids via getRoles. Only whitelist flags.",
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, roleId, allow = [], deny = [] } = input as {
          channelId: string;
          roleId: string;
          allow?: string[];
          deny?: string[];
        };
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !('permissionOverwrites' in channel)) {
          return { ok: false, summary: 'Salon ou catégorie introuvable.' };
        }
        if (!botPermissionPolicy.canInGuild(guild, 'ManageRoles')) {
          return { ok: false, summary: botPermissionPolicy.refusal('ManageRoles') };
        }
        const areAssignable = (flags: string[]): boolean => flags.every((flag) => isAssignablePermissionName(flag));
        if (!areAssignable(allow) || !areAssignable(deny)) {
          return {
            ok: false,
            summary:
              'Flag inconnu (ou Administrator interdit). Valides : ViewChannel, SendMessages, ReadMessageHistory, Connect, Speak, Stream, CreateInstantInvite, AddReactions, EmbedLinks, AttachFiles, MentionEveryone, ManageChannels, ManageMessages, ManageRoles, ManageWebhooks, PrioritySpeaker, MoveMembers, MuteMembers, DeafenMembers.',
          };
        }
        const overwrite: Record<string, boolean> = {};
        for (const flag of allow) overwrite[flag] = true;
        for (const flag of deny) overwrite[flag] = false;
        const target = channel as GuildChannel;
        const existing = target.permissionOverwrites.cache.get(roleId);
        const preOverwrite = existing
          ? { allow: existing.allow.toArray(), deny: existing.deny.toArray() }
          : { allow: [], deny: [] };
        await target.permissionOverwrites.edit(roleId, overwrite, { reason: agentReason(ctx) });
        const who = roleId === guild.id ? 'le rôle everyone' : `<@&${roleId}>`;
        return withPreState(
          {
            ok: true,
            summary: `Permissions de <#${channel.id}> pour ${who} : +[${allow.join(', ') || '∅'}] -[${deny.join(', ') || '∅'}].`,
            data: { channelId: channel.id, roleId },
          },
          { channelId: channel.id, roleId, oldOverwrite: preOverwrite },
        );
      },
    },
  ];
}
