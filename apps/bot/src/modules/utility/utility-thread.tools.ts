import { ChannelType } from 'discord.js';
import { z } from 'zod';
import { botPermissionPolicy } from '../../core/security/bot-permission.policy';
import type { BotTool } from '@10cordes/shared';
import type { UtilityToolsDeps } from './utility-resolver';

/**
 * Tools des fils de discussion : post dans un salon forum, fil ancré sous un
 * message existant, ajout d'un membre à un fil.
 */

/** Tool forum.post : crée un post (fil) dans un salon forum, avec son message de démarrage. */
export function forumPostTool(deps: UtilityToolsDeps): BotTool {
  const { resolver } = deps;
  return {
    name: 'forum.post',
    description: 'Crée un post dans un salon forum (titre + message de démarrage).',
    category: 'utility',
    paramsSchema: z.object({
      channelId: z.string().min(1).describe('ID du salon forum'),
      title: z.string().min(1).max(100),
      content: z.string().min(1).max(2000),
    }),
    requiredModules: [],
    permissions: ['ManageThreads'],
    destructive: false,
    systemPrompt: 'Le salon cible doit être un forum.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const guild = resolver.guildOf(ctx);
      if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { channelId, title, content } = input as { channelId: string; title: string; content: string };
      const channel = guild.channels.cache.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildForum) return { ok: false, summary: 'Salon introuvable ou pas un forum.' };
      if (!botPermissionPolicy.canInGuild(guild, 'CreatePublicThreads')) {
        return { ok: false, summary: botPermissionPolicy.refusal('CreatePublicThreads') };
      }
      const thread = await channel.threads.create({ name: title.slice(0, 100), message: { content: content.slice(0, 2000) } }).catch(() => null);
      if (!thread) return { ok: false, summary: 'Création du post impossible (permissions ?).' };
      return { ok: true, summary: `Post « ${title} » créé : <#${thread.id}>` };
    },
  };
}

/** Tool thread.create : crée un fil de discussion ancré sous un message existant. */
export function threadCreateTool(deps: UtilityToolsDeps): BotTool {
  const { resolver } = deps;
  return {
    name: 'thread.create',
    description: 'Crée un fil sous un message existant.',
    category: 'utility',
    paramsSchema: z.object({
      channelId: z.string().min(1),
      messageId: z.string().min(1),
      name: z.string().min(1).max(100),
    }),
    requiredModules: [],
    permissions: ['ManageThreads'],
    destructive: false,
    systemPrompt: 'Fil de discussion ancré sur un message.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const guild = resolver.guildOf(ctx);
      if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { channelId, messageId, name } = input as { channelId: string; messageId: string; name: string };
      const channel = resolver.textChannel(ctx.guildId, channelId);
      if (!channel || channel.isThread() || channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
        return { ok: false, summary: 'Salon introuvable ou non textuel.' };
      }
      const thread = await channel.threads
        .create({ name: name.slice(0, 100), startMessage: messageId })
        .catch(() => null);
      if (!thread) return { ok: false, summary: 'Création du fil impossible (message introuvable ou permissions ?).' };
      return { ok: true, summary: `Fil « ${name} » créé : <#${thread.id}>` };
    },
  };
}

/** Tool thread.addMember : ajoute un membre à un fil (primitive des tickets par threads). */
export function threadAddMemberTool(deps: UtilityToolsDeps): BotTool {
  const { client } = deps;
  return {
    name: 'thread.addMember',
    description: 'Ajoute un membre à un fil (les fils PRIVÉS exigent un ajout explicite : ceci est la primitive des systèmes de tickets par threads).',
    category: 'utility',
    paramsSchema: z.object({ threadId: z.string().min(1), userId: z.string().min(1) }),
    requiredModules: [],
    permissions: [],
    destructive: false,
    systemPrompt: "Read-before-write : vérifie via getMembers que le membre existe. Le bot doit être membre du fil pour y ajouter quelqu'un.",
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { threadId, userId } = input as { threadId: string; userId: string };
      const thread = await client.channels.fetch(threadId).catch(() => null);
      if (!thread?.isThread()) return { ok: false, summary: 'Fil introuvable.' };
      const added = await thread.members.add(userId).then(() => true).catch(() => false);
      return added
        ? { ok: true, summary: `<@${userId}> ajouté au fil <#${threadId}>.` }
        : { ok: false, summary: "Ajout impossible (membre introuvable, déjà membre, ou bot hors du fil ?)." };
    },
  };
}
