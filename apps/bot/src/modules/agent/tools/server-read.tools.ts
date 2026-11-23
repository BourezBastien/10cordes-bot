import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import type { DiscordToolContext } from './tool-context';
import { buildServerStyleGuide } from './tool-support';

/** Tools de lecture du serveur : infos, salons, rôles, style, émojis. */
export function serverReadTools(toolCtx: DiscordToolContext): BotTool[] {
  const { guildOf, noGuild } = toolCtx;
  return [
    {
      name: 'getServerInfo',
      description: 'Infos du serveur : nom, membres, owner, nombre de salons et rôles.',
      category: 'agent',
      paramsSchema: z.record(z.string(), z.unknown()),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Read-only. Use first to ground any server-wide request.',
      handler: async (_input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        return {
          ok: true,
          summary: `${guild.name} : ${guild.memberCount} membres, ${guild.channels.cache.size} salons, ${guild.roles.cache.size} rôles.`,
          data: { id: guild.id, name: guild.name, ownerId: guild.ownerId },
        };
      },
    },
    {
      name: 'getChannels',
      description: 'Liste les salons (id, nom, type).',
      category: 'agent',
      paramsSchema: z.record(z.string(), z.unknown()),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Read-only. Resolve channel NAMES to IDs here before any channel mutation.',
      handler: async (_input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const channels = guild.channels.cache.map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
        }));
        return { ok: true, summary: `${channels.length} salons.`, data: { channels } };
      },
    },
    {
      name: 'getRoles',
      description: 'Liste les rôles (id, nom, couleur, position).',
      category: 'agent',
      paramsSchema: z.record(z.string(), z.unknown()),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Read-only. Resolve role NAMES to IDs here before any role mutation.',
      handler: async (_input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const roles = guild.roles.cache
          .filter((role) => !role.managed && role.id !== guild.id)
          .map((role) => ({ id: role.id, name: role.name, color: role.color, position: role.position }));
        return { ok: true, summary: `${roles.length} rôles.`, data: { roles } };
      },
    },
    {
      name: 'getServerStyle',
      description:
        "Analyse la structure et le style du serveur : catégories (noms, positions), salons enfants (types, topics), permissions par salon, rôles. À appeler AVANT toute création ou modification pour imiter les conventions existantes.",
      category: 'agent',
      paramsSchema: z.record(z.string(), z.unknown()),
      requiredModules: [],
      destructive: false,
      systemPrompt:
        'Read-only. THE tool before any creation or edit: reproduce the detected conventions exactly (emoji prefixes, special unicode casing, separators, naming style) and reuse the permission schema of similar categories via setChannelOverwrite. After building something styled, save a one-line style summary with saveServerMemory so you remember it.',
      handler: async (_input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        return buildServerStyleGuide(guild);
      },
    },
    {
      name: 'getEmojis',
      description: 'Liste les émojis du serveur.',
      category: 'agent',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (_input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const emojis = guild.emojis.cache.map((e) => `${e} (\`${e.name}\`)`).slice(0, 25);
        return { ok: true, summary: `${guild.emojis.cache.size} émoji(s) : ${emojis.join(' ') || 'aucun'}` };
      },
    },
  ];
}
