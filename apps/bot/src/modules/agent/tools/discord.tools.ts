import { PermissionFlagsBits, type Client, type Guild } from 'discord.js';
import { z } from 'zod';
import type { AdminOp, BotTool, ToolResult, ToolRunContext } from '@10cordes/shared';
import { getToolRegistry } from '../../tool-registry/tool-registry.service';
import type { AgentService } from '../agent.service';
import { discordExtraTools } from './discord.tools.extra';

/**
 * Tools Discord de l'Agent Admin — chaque tool embarque son propre systemPrompt
 * (préconditions, effets, refus) et exécute DIRECTEMENT (plus de plans depuis
 * le 17/11) : gates de permissions en code pour le demandeur ET le bot,
 * archive-first pour les suppressions, tout audité.
 */
export interface ToolHelpers {
  guildOf: (ctx: ToolRunContext) => Guild | null;
  noGuild: () => ToolResult;
}

export function agentTools(agent: AgentService, client: Client): BotTool[] {
  const guildOf = (ctx: ToolRunContext): Guild | null =>
    ctx.guildId ? (client.guilds.cache.get(ctx.guildId) ?? null) : null;
  const noGuild = (): ToolResult => ({ ok: false, summary: 'Contexte de serveur requis.' });

  /** Exécution directe d'une op via AgentService (gates + audit inclus). */
  const executeDirectOp = async (ctx: ToolRunContext, op: AdminOp): Promise<ToolResult> => {
    const guild = guildOf(ctx);
    if (!guild) return noGuild();
    const result = await agent.executeDirect(guild.id, ctx.userId, op);
    return { ok: result.ok, summary: `${result.label}${result.detail ? ` (${result.detail})` : ''}` };
  };


  const baseTools: BotTool[] = [
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
      name: 'createChannel',
      description: 'Crée un salon texte, vocal ou une catégorie, avec placement optionnel (catégorie parente, position).',
      category: 'agent',
      paramsSchema: z.object({
        name: z.string().min(1).max(100),
        kind: z.enum(['text', 'voice', 'category']).default('text'),
        topic: z.string().max(1024).optional(),
        categoryId: z.string().min(1).optional(),
        position: z.number().int().min(1).max(100).optional(),
      }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt:
        'Tier 2 (reversible). Call getServerStyle FIRST and imitate the detected conventions (emoji prefixes, special casing) before naming. Place with categoryId; position = slot in the list (1 = top).',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { name, kind, topic, categoryId, position } = input as {
          name: string;
          kind: 'text' | 'voice' | 'category';
          topic?: string;
          categoryId?: string;
          position?: number;
        };
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return { ok: false, summary: "Le bot n'a pas la permission ManageChannels." };
        }
        const created = await guild.channels.create({
          name,
          type: kind === 'voice' ? 2 : kind === 'category' ? 4 : 0,
          topic,
          parent: categoryId,
          reason: `agent tool (by <@${ctx.userId}>)`,
        });
        if (position !== undefined) {
          await created.setPosition(position, { reason: `agent tool (by <@${ctx.userId}>)` }).catch(() => {});
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
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return { ok: false, summary: "Le bot n'a pas la permission ManageChannels." };
        }
        const oldName = channel.name;
        await channel.setName(name, `agent tool (by <@${ctx.userId}>)`);
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
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return { ok: false, summary: "Le bot n'a pas la permission ManageChannels." };
        }
        await channel.setName(`archive-${channel.name}`, `agent tool (by <@${ctx.userId}>)`);
        return { ok: true, summary: `Salon archivé : **archive-${channel.name}**.` };
      },
    },
    {
      name: 'createRole',
      description: 'Crée un rôle (nom + couleur optionnelle en entier hex).',
      category: 'agent',
      paramsSchema: z.object({
        name: z.string().min(1).max(100),
        color: z.number().int().min(0).max(0xffffff).optional(),
      }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). Requires bot ManageRoles. Ask the user for the color if ambiguous.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { name, color } = input as { name: string; color?: number };
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          return { ok: false, summary: "Le bot n'a pas la permission ManageRoles." };
        }
        const role = await guild.roles.create({ name, color, reason: `agent tool (by <@${ctx.userId}>)` });
        return { ok: true, summary: `Rôle **${name}** créé → <@&${role.id}>`, data: { roleId: role.id } };
      },
    },
    {
      name: 'muteMember',
      description: 'Met un membre en timeout temporaire (max 28 jours).',
      category: 'agent',
      paramsSchema: z.object({
        userId: z.string().min(1),
        durationMs: z.number().int().min(1_000).max(28 * 24 * 60 * 60 * 1_000),
        reason: z.string().max(512).optional(),
      }),
      requiredModules: [],
      permissions: ['ModerateMembers'],
      destructive: true,
      systemPrompt:
        'Temporary sanction (max 28 days), gated by ModerateMembers. Hiérarchie vérifiée : demandeur ET bot au-dessus de la cible. Pour une révocation AUTOMATIQUE, préfère temp.sanction (timeout auto-révoqué).',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId, durationMs, reason } = input as { userId: string; durationMs: number; reason?: string };
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { ok: false, summary: 'Membre introuvable.' };
        const me = guild.members.me;
        if (!me) return { ok: false, summary: 'Bot non chargé.' };

        const requester = await guild.members.fetch(ctx.userId).catch(() => null);
        if (requester) {
          if (!requester.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return { ok: false, summary: 'Permission ModerateMembers requise pour le demandeur.' };
          }
          if (guild.ownerId !== ctx.userId && member.roles.highest.comparePositionTo(requester.roles.highest) >= 0) {
            return { ok: false, summary: 'Le demandeur a un rôle inférieur ou égal à la cible.' };
          }
        }
        if (member.roles.highest.comparePositionTo(me.roles.highest) >= 0) {
          return { ok: false, summary: 'Le bot a un rôle inférieur ou égal à la cible.' };
        }
        await member.timeout(durationMs, reason ?? `agent tool (by <@${ctx.userId}>)`);
        return { ok: true, summary: `Timeout de ${Math.round(durationMs / 60_000)} min appliqué à <@${userId}>.` };
      },
    },
    {
      name: 'purgeMessages',
      description:
        "Supprime en masse les messages récents d'un salon. Filtre obligatoire par âge (days) pour ne JAMAIS toucher les vieux messages : days=1 = aujourd'hui/hier uniquement, days=14 maximum (limite Discord du bulk delete). Les messages plus vieux que la fenêtre sont comptés et laissés en place.",
      category: 'agent',
      paramsSchema: z.object({
        channelId: z.string().min(1).optional(),
        count: z.number().int().min(1).max(1000).default(100),
        days: z
          .number()
          .int()
          .min(1)
          .max(14)
          .default(1)
          .describe("Fenêtre d'âge : ne supprime que les messages de moins de N jours (1 = aujourd'hui). Discord interdit le bulk delete au-delà de 14 jours."),
      }),
      requiredModules: [],
      permissions: ['ManageMessages'],
      destructive: true,
      systemPrompt:
        'DESTRUCTIF mais borné : le filtre days protège les vieux messages — demande la fenêtre si l\u0029utilisateur ne la précise pas (« tout le salon » = days à demander quand même). Jamais de purge sans fenêtre d\u0029âge.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, count, days } = input as { channelId?: string; count?: number; days?: number };
        const targetId = channelId || ctx.channelId || '';
        const channel = await guild.channels.fetch(targetId).catch(() => null);
        if (!channel || !channel.isTextBased()) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
          return { ok: false, summary: "Le bot n'a pas la permission ManageMessages." };
        }
        const budget = count ?? 100;
        const windowMs = (days ?? 1) * 86_400_000;
        const cutoff = Date.now() - windowMs;
        let deleted = 0;
        let skippedOld = 0;
        for (let round = 0; round < 10 && deleted < budget; round++) {
          const batch = await channel.messages.fetch({ limit: 100 }).catch(() => null);
          if (!batch || batch.size === 0) break;
          // Filtrage STRICT par âge AVANT le bulkDelete : Discord refuse le
          // bulk au-delà de 14 jours, et l'utilisateur demande une fenêtre
          // précise (« aujourd'hui ») — jamais toucher les vieux messages.
          const inWindowAll = batch.filter((message) => message.createdTimestamp >= cutoff && !message.pinned);
          const tooOld = batch.filter((message) => message.createdTimestamp < cutoff);
          skippedOld += tooOld.size;
          if (inWindowAll.size === 0) break;
          // Le budget count est respecté PAR LOT (l'ancien code pouvait
          // supprimer jusqu'à 100 messages pour un count=5).
          const inWindow = inWindowAll.first(budget - deleted);
          const done = await channel.bulkDelete(inWindow, true).catch(() => null);
          if (!done || done.size === 0) break;
          deleted += done.size;
        }
        const note = skippedOld > 0 ? ` ${skippedOld} message(s) plus vieux que ${days ?? 1}j laissés en place.` : '';
        return { ok: true, summary: `🧹 ${deleted} message(s) supprimé(s) dans <#${channel.id}> (fenêtre ${days ?? 1}j).${note}` };
      },
    },
    {
      name: 'deleteChannel',
      description: 'Supprime un salon (snapshot archivé avant suppression). Exécution directe : permissions du demandeur vérifiées.',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: true,
      systemPrompt:
        'DESTRUCTIVE but EXECUTES DIRECTLY (no confirmation, no plan): permission-gated. The requester needs ManageChannels and the bot needs ManageChannels. archiveChannel is the gentler alternative unless the user explicitly wants deletion. Fail fast with the tool result if a permission is missing (requester OR bot), never invent obstacles.',
      handler: async (input, ctx) => {
        const { channelId } = input as { channelId: string };
        return executeDirectOp(ctx, { type: 'channel.delete', channelId });
      },
    },
    {
      name: 'channel.remove',
      description:
        'Supprime un salon immédiatement ou APRÈS UN DÉLAI (delayMinutes) via le moteur de jobs — survit aux redémarrages. Idéal pour les fermetures de tickets différées et les cleanups planifiés.',
      category: 'agent',
      paramsSchema: z.object({
        channelId: z.string().min(1),
        delayMinutes: z.number().int().min(0).max(10_080).default(0).describe('0 = immédiat ; sinon suppression différée'),
      }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: true,
      systemPrompt:
        'Pour les suppressions différées (« supprime ce salon dans 10 minutes ») : delayMinutes + jobs.schedule runTool channel.remove à l\u0029échéance. Un snapshot est archivé avant.',
      handler: async (input, ctx) => {
        const { channelId, delayMinutes } = input as { channelId: string; delayMinutes?: number };
        if (!delayMinutes) return executeDirectOp(ctx, { type: 'channel.delete', channelId });
        const registry = getToolRegistry();
        const scheduled = await registry.run(
          'jobs.schedule',
          {
            name: `delete-${channelId}`,
            kind: 'once',
            runAtIso: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
            actions: [{ type: 'runTool', name: 'channel.remove', input: { channelId, delayMinutes: 0 } }],
          },
          ctx,
        );
        return {
          ok: scheduled.ok,
          summary: `Salon <#${channelId}> supprimé automatiquement dans ${delayMinutes} min.`,
        };
      },
    },
    {
      name: 'deleteRole',
      description: 'Supprime un rôle (snapshot stocké). Exécution directe : permissions du demandeur vérifiées.',
      category: 'agent',
      paramsSchema: z.object({ roleId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: true,
      systemPrompt:
        'DESTRUCTIVE but EXECUTES DIRECTLY (no confirmation, no plan): permission-gated. Never guess the roleId: use getRoles. Fail fast with the tool result if a permission is missing, never invent obstacles.',
      handler: async (input, ctx) => {
        const { roleId } = input as { roleId: string };
        return executeDirectOp(ctx, { type: 'role.delete', roleId });
      },
    },
    {
      name: 'kickMember',
      description: 'Expulse un membre du serveur (bots inclus). Exécution directe : permissions du demandeur vérifiées.',
      category: 'agent',
      paramsSchema: z.object({
        userId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
      requiredModules: [],
      permissions: ['KickMembers'],
      destructive: true,
      systemPrompt:
        'EXECUTES DIRECTLY (no confirmation, no plan): permission-gated. Requires requester KickMembers and bot KickMembers, hierarchy applies. Temporary alternative: muteMember. Kicking ANOTHER BOT member is a normal Discord action.',
      handler: async (input, ctx) => {
        const { userId, reason } = input as { userId: string; reason?: string };
        return executeDirectOp(ctx, { type: 'member.kick', userId, reason });
      },
    },
    {
      name: 'banMember',
      description: 'Bannit un utilisateur du serveur. Exécution directe : permissions du demandeur vérifiées.',
      category: 'agent',
      paramsSchema: z.object({
        userId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
      requiredModules: [],
      permissions: ['BanMembers'],
      destructive: true,
      systemPrompt:
        'EXECUTES DIRECTLY (no confirmation, no plan): permission-gated. A moderation case is created. Requires requester BanMembers and bot BanMembers. Fail fast with the tool result, never invent obstacles.',
      handler: async (input, ctx) => {
        const { userId, reason } = input as { userId: string; reason?: string };
        return executeDirectOp(ctx, { type: 'member.ban', userId, reason });
      },
    },
  ];

  return [...baseTools, ...discordExtraTools(agent, client, { guildOf, noGuild })];
}
