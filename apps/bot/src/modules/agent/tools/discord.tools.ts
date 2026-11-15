import { PermissionFlagsBits, type Client, type Guild } from 'discord.js';
import { z } from 'zod';
import {
  AgentPlanSchema,
  type BotTool,
  type ToolResult,
  type ToolRunContext,
} from '@10cordes/shared';
import { AgentService } from '../agent.service';

/**
 * Tools Discord de l'Agent Admin — chaque tool embarque son propre systemPrompt
 * (préconditions, effets, refus) et respecte la grille de tiers :
 * - lecture libre ;
 * - tier 2 (créer / renommer / archiver / timeout) : exécution directe, permission vérifiée en code ;
 * - tier 3 (supprimer / kick / ban) : création d'un PLAN soumis à confirmation humaine (whitelist).
 */
export function agentTools(agent: AgentService, client: Client): BotTool[] {
  const guildOf = (ctx: ToolRunContext): Guild | null =>
    ctx.guildId ? (client.guilds.cache.get(ctx.guildId) ?? null) : null;
  const noGuild = (): ToolResult => ({ ok: false, summary: 'Contexte de serveur requis.' });

  const proposePlan = async (
    ctx: ToolRunContext,
    title: string,
    ops: Array<Record<string, unknown>>,
  ): Promise<ToolResult> => {
    const parsed = AgentPlanSchema.safeParse({ title, ops });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        summary: `Plan invalide (${issue?.path.join('.') || 'ops'}) : ${issue?.message ?? ''}`,
      };
    }
    if (!ctx.guildId || !ctx.channelId) return { ok: false, summary: 'Contexte de serveur et de canal requis.' };
    const plan = await agent.createPlan(ctx.guildId, ctx.channelId, ctx.userId, parsed.data);
    return {
      ok: true,
      summary: `Plan #${plan.planId} proposé — ${plan.destructiveOps.length} op(s) destructive(s). En attente de confirmation humaine (5 min).`,
      data: { planId: plan.planId },
    };
  };

  return [
    {
      name: 'discord.guild.info',
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
          summary: `${guild.name} — ${guild.memberCount} membres, ${guild.channels.cache.size} salons, ${guild.roles.cache.size} rôles.`,
          data: { id: guild.id, name: guild.name, ownerId: guild.ownerId },
        };
      },
    },
    {
      name: 'discord.channel.list',
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
      name: 'discord.role.list',
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
      name: 'discord.channel.create',
      description: 'Crée un salon texte, vocal ou une catégorie.',
      category: 'agent',
      paramsSchema: z.object({
        name: z.string().min(1).max(100),
        kind: z.enum(['text', 'voice', 'category']).default('text'),
        topic: z.string().max(1024).optional(),
      }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt:
        'Tier 2 (reversible via rename/archive with confirmation). Requires bot ManageChannels. Use channel.list first to avoid duplicates.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { name, kind, topic } = input as { name: string; kind: 'text' | 'voice' | 'category'; topic?: string };
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return { ok: false, summary: "Le bot n'a pas la permission ManageChannels." };
        }
        const created = await guild.channels.create({
          name,
          type: kind === 'voice' ? 2 : kind === 'category' ? 4 : 0,
          topic,
          reason: `agent tool (by <@${ctx.userId}>)`,
        });
        return { ok: true, summary: `Salon **${name}** créé → <#${created.id}>`, data: { channelId: created.id } };
      },
    },
    {
      name: 'discord.channel.rename',
      description: 'Renomme un salon.',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1), name: z.string().min(1).max(100) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). Requires bot ManageChannels. Resolve the channel via channel.list first — never guess IDs.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, name } = input as { channelId: string; name: string };
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !('setName' in channel)) return { ok: false, summary: 'Salon introuvable.' };
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return { ok: false, summary: "Le bot n'a pas la permission ManageChannels." };
        }
        await channel.setName(name, `agent tool (by <@${ctx.userId}>)`);
        return { ok: true, summary: `Salon renommé en **${name}**.` };
      },
    },
    {
      name: 'discord.channel.archive',
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
      name: 'discord.role.create',
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
      name: 'discord.member.timeout',
      description: 'Met un membre en timeout temporaire (max 28 jours).',
      category: 'agent',
      paramsSchema: z.object({
        userId: z.string().min(1),
        durationMs: z.number().int().min(1_000).max(28 * 24 * 60 * 60 * 1_000),
        reason: z.string().max(512).optional(),
      }),
      requiredModules: [],
      permissions: ['ModerateMembers'],
      destructive: false,
      systemPrompt:
        'Temporary sanction (max 28 days) — available to anyone with ModerateMembers, NOT whitelist-gated. Creates a moderation case. Requires bot ModerateMembers and a bot role above the target.',
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
      name: 'discord.channel.delete',
      description: 'Supprime un salon — passe obligatoirement par un plan confirmé (snapshot archivé avant suppression).',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: true,
      systemPrompt:
        'Tier 3 / DESTRUCTIVE — never executes directly: it creates a PLAN requiring owner-or-whitelist approval within 5 minutes. The default alternative is discord.channel.archive — prefer it unless the user explicitly wants deletion.',
      handler: async (input, ctx) => proposePlan(ctx, 'Suppression de salon', [input as Record<string, unknown>]),
    },
    {
      name: 'discord.role.delete',
      description: 'Supprime un rôle — passe obligatoirement par un plan confirmé (snapshot stocké).',
      category: 'agent',
      paramsSchema: z.object({ roleId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: true,
      systemPrompt: 'Tier 3 / DESTRUCTIVE — creates a plan for human approval. Never guess the roleId: use role.list.',
      handler: async (input, ctx) => proposePlan(ctx, 'Suppression de rôle', [input as Record<string, unknown>]),
    },
    {
      name: 'discord.member.kick',
      description: 'Expulse un membre — passe obligatoirement par un plan confirmé (whitelist).',
      category: 'agent',
      paramsSchema: z.object({
        userId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
      requiredModules: [],
      permissions: ['KickMembers'],
      destructive: true,
      systemPrompt:
        'Tier 3 / DESTRUCTIVE and WHITELIST-GATED (owner + whitelisted IDs only). Creates a plan for approval. Temporary alternative: discord.member.timeout.',
      handler: async (input, ctx) => proposePlan(ctx, 'Expulsion de membre', [input as Record<string, unknown>]),
    },
    {
      name: 'discord.member.ban',
      description: 'Bannit un utilisateur — passe obligatoirement par un plan confirmé (whitelist).',
      category: 'agent',
      paramsSchema: z.object({
        userId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
      requiredModules: [],
      permissions: ['BanMembers'],
      destructive: true,
      systemPrompt:
        'Tier 3 / DESTRUCTIVE and WHITELIST-GATED. Creates a plan; a moderation case is created at execution time.',
      handler: async (input, ctx) => proposePlan(ctx, 'Bannissement', [input as Record<string, unknown>]),
    },
  ];
}
