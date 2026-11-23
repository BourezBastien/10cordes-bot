import { ChannelType, type GuildChannel } from 'discord.js';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { botPermissionPolicy } from '../../../core/security/bot-permission.policy';
import type { DiscordToolContext } from './tool-context';
import { agentReason } from './tool-context';
import { withPreState } from './tool-support';

/** Tools sur les catégories : création placée et déplacement d'un salon. */
export function categoryTools(toolCtx: DiscordToolContext): BotTool[] {
  const { guildOf, noGuild } = toolCtx;
  return [
    {
      name: 'createCategory',
      description: 'Crée une catégorie (conteneur de salons), position optionnelle dans la liste des salons.',
      category: 'agent',
      paramsSchema: z.object({
        name: z.string().min(1).max(100),
        position: z.number().int().min(1).max(100).optional(),
      }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt:
        'Tier 2 (reversible). channel.list pour éviter les doublons ET pour imiter les conventions de nommage existantes. position = emplacement voulu dans la liste des catégories (1 = tout en haut) ; par défaut la catégorie va en bas.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { name, position } = input as { name: string; position?: number };
        if (!botPermissionPolicy.canInGuild(guild, 'ManageChannels')) {
          return { ok: false, summary: botPermissionPolicy.refusal('ManageChannels') };
        }
        const created = await guild.channels.create({ name, type: ChannelType.GuildCategory, reason: agentReason(ctx) });
        if (position !== undefined) {
          await created.setPosition(position, { reason: agentReason(ctx) }).catch(() => {});
        }
        return {
          ok: true,
          summary: `Catégorie **${name}** créée${position !== undefined ? ` en position ${position}` : ' (en bas de la liste)'}.`,
          data: { categoryId: created.id },
        };
      },
    },
    {
      name: 'moveChannel',
      description: "Déplace un salon dans une catégorie, ou à la racine du serveur si categoryId est omis.",
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), categoryId: z.string().min(1).optional() }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). Resolve both via channel.list first. Omit categoryId to move the channel to the server root.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, categoryId } = input as { channelId: string; categoryId?: string };
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return { ok: false, summary: 'Salon introuvable.' };
        const movable = channel as GuildChannel;
        const oldParentId = channel.parentId;
        if (categoryId === undefined || categoryId === null) {
          await movable.setParent(null, { lockPermissions: false, reason: agentReason(ctx) });
          return withPreState({ ok: true, summary: `<#${channelId}> déplacé à la racine du serveur.` }, { channelId, oldParentId });
        }
        const category = await guild.channels.fetch(categoryId).catch(() => null);
        if (!category || category.type !== 4) return { ok: false, summary: 'Catégorie introuvable.' };
        await movable.setParent(categoryId, { lockPermissions: false, reason: agentReason(ctx) });
        return withPreState({ ok: true, summary: `<#${channelId}> déplacé dans **${category.name}**.` }, { channelId, oldParentId });
      },
    },
  ];
}
