import { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, type Client, type Guild } from 'discord.js';
import { z } from 'zod';
import {
  AdminOpSchema,
  AgentPlanSchema,
  DESTRUCTIVE_OP_TYPES,
  type BotTool,
  type ToolResult,
  type ToolRunContext,
} from '@10cordes/shared';
import { AgentService } from '../agent.service';
import { buildPlanReply } from '../agent.panel';
import { ANSWER_VIEW_ID, storeAnswer } from '../../assistant/handlers/answer-view.handler';
import { text } from '../../../shared/ui';
import { discordExtraTools } from './discord.tools.extra';

/**
 * Tools Discord de l'Agent Admin — chaque tool embarque son propre systemPrompt
 * (préconditions, effets, refus) et respecte la grille de tiers :
 * - lecture libre ;
 * - tier 2 (créer / renommer / archiver / timeout) : exécution directe, permission vérifiée en code ;
 * - tier 3 (supprimer / kick / ban) : création d'un PLAN soumis à confirmation humaine (whitelist).
 */
export interface ToolHelpers {
  guildOf: (ctx: ToolRunContext) => Guild | null;
  noGuild: () => ToolResult;
  proposePlan: (ctx: ToolRunContext, title: string, ops: Array<Record<string, unknown>>) => Promise<ToolResult>;
}

export function agentTools(agent: AgentService, client: Client): BotTool[] {
  const guildOf = (ctx: ToolRunContext): Guild | null =>
    ctx.guildId ? (client.guilds.cache.get(ctx.guildId) ?? null) : null;
  const noGuild = (): ToolResult => ({ ok: false, summary: 'Contexte de serveur requis.' });

  const proposePlan: ToolHelpers['proposePlan'] = async (
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

    // Portail minuscule (public) : le PANNEAU complet (ops + boutons) part en
    // ÉPHÉMÈRE, visible uniquement par la personne qui a fait la demande.
    const channel = await client.channels.fetch(ctx.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) {
      return { ok: false, summary: 'Salon introuvable pour poster le portail de confirmation.' };
    }

    const destructive = parsed.data.ops.some((op) => DESTRUCTIVE_OP_TYPES.has(op.type));
    const planReply = buildPlanReply({
      title: parsed.data.title,
      ops: parsed.data.ops,
      requesterId: ctx.userId,
      expiresAt: new Date(Date.now() + 5 * 60 * 1_000),
      destructive,
    });
    const portalContainer = new ContainerBuilder()
      .setAccentColor(destructive ? 0xe8_8b_94 : 0x57_f2_87)
      .addTextDisplayComponents(
        text(
          `**Plan « ${parsed.data.title} »** : ${parsed.data.ops.length} op(s) en attente de confirmation (5 min). Clique pour consulter et valider.`,
        ),
      )
      .addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(ANSWER_VIEW_ID).setLabel('Consulter le plan').setStyle(ButtonStyle.Primary),
        ),
      );
    const portal = await channel
      .send({ components: [portalContainer], flags: MessageFlags.IsComponentsV2 })
      .catch(() => null);
    if (!portal) return { ok: false, summary: 'Impossible de poster le portail de confirmation.' };

    // Réservé au demandeur : le clic d'un autre membre est refusé par le handler.
    storeAnswer(portal.id, { components: planReply.components, ownerId: ctx.userId });

    const plan = await agent.createPlan(ctx.guildId, ctx.channelId, ctx.userId, parsed.data, portal.id);
    return {
      ok: true,
      summary: `Plan #${plan.planId} proposé : ${plan.destructiveOps.length} op(s) destructive(s). Panneau de confirmation éphémère envoyé au demandeur (5 min).`,
      data: { planId: plan.planId },
    };
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
        await channel.setName(name, `agent tool (by <@${ctx.userId}>)`);
        return { ok: true, summary: `Salon renommé en **${name}**.` };
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
      destructive: false,
      systemPrompt:
        'Temporary sanction (max 28 days), available to anyone with ModerateMembers, NOT whitelist-gated. Creates a moderation case. Requires bot ModerateMembers and a bot role above the target.',
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
        "Supprime en masse les messages récents d'un salon (par lots de 100, max 1000, uniquement les moins de 14 jours).",
      category: 'agent',
      paramsSchema: z.object({
        channelId: z.string().min(1).optional(),
        count: z.number().int().min(1).max(1000).default(100),
      }),
      requiredModules: [],
      permissions: ['ManageMessages'],
      destructive: false,
      systemPrompt:
        'Bulk delete, irreversible. When the user asks to wipe a whole channel, confirm the scope first, then purge in batches until done.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { channelId, count } = input as { channelId?: string; count?: number };
        const targetId = channelId || ctx.channelId || '';
        const channel = await guild.channels.fetch(targetId).catch(() => null);
        if (!channel || !channel.isTextBased()) return { ok: false, summary: 'Salon introuvable ou non textuel.' };
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
          return { ok: false, summary: "Le bot n'a pas la permission ManageMessages." };
        }
        const budget = count ?? 100;
        let deleted = 0;
        for (let round = 0; round < 10 && deleted < budget; round++) {
          const batch = await channel.bulkDelete(Math.min(100, budget - deleted), true).catch(() => null);
          if (!batch || batch.size === 0) break;
          deleted += batch.size;
        }
        return { ok: true, summary: `🧹 ${deleted} message(s) supprimé(s) dans <#${channel.id}>.` };
      },
    },
    {
      name: 'deleteChannel',
      description: 'Supprime un salon, en passant obligatoirement par un plan confirmé (snapshot archivé avant suppression).',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: true,
      systemPrompt:
        'Tier 3 / DESTRUCTIVE, never executes directly: it creates a PLAN requiring owner-or-whitelist approval within 5 minutes. The default alternative is archiveChannel, prefer it unless the user explicitly wants deletion. For several deletions, use ONE grouped proposePlan call.',
      handler: async (input, ctx) => {
        const { channelId } = input as { channelId: string };
        return proposePlan(ctx, 'Suppression de salon', [{ type: 'channel.delete', channelId }]);
      },
    },
    {
      name: 'deleteRole',
      description: 'Supprime un rôle, en passant obligatoirement par un plan confirmé (snapshot stocké).',
      category: 'agent',
      paramsSchema: z.object({ roleId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: true,
      systemPrompt: 'Tier 3 / DESTRUCTIVE, creates a plan for human approval. Never guess the roleId: use role.list.',
      handler: async (input, ctx) => {
        const { roleId } = input as { roleId: string };
        return proposePlan(ctx, 'Suppression de rôle', [{ type: 'role.delete', roleId }]);
      },
    },
    {
      name: 'kickMember',
      description: 'Expulse un membre, en passant obligatoirement par un plan confirmé (whitelist).',
      category: 'agent',
      paramsSchema: z.object({
        userId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
      requiredModules: [],
      permissions: ['KickMembers'],
      destructive: true,
      systemPrompt:
        'Tier 3 / DESTRUCTIVE and WHITELIST-GATED (owner + whitelisted IDs only). Creates a plan for approval. Temporary alternative: muteMember.',
      handler: async (input, ctx) => {
        const { userId, reason } = input as { userId: string; reason?: string };
        return proposePlan(ctx, 'Expulsion de membre', [{ type: 'member.kick', userId, reason }]);
      },
    },
    {
      name: 'banMember',
      description: 'Bannit un utilisateur, en passant obligatoirement par un plan confirmé (whitelist).',
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
      handler: async (input, ctx) => {
        const { userId, reason } = input as { userId: string; reason?: string };
        return proposePlan(ctx, 'Bannissement', [{ type: 'member.ban', userId, reason }]);
      },
    },
    {
      name: 'proposePlan',
      description:
        'Propose UN plan groupé de plusieurs ops (salons, rôles, membre) soumis à une confirmation par boutons. À préférer aux appels séparés pour toute demande multi-actions.',
      category: 'agent',
      paramsSchema: z.object({
        title: z.string().min(1).max(256),
        ops: z.array(AdminOpSchema).min(1).max(20),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'USE THIS for multi-action requests (e.g. "delete these 3 channels", "set up a member space"): ONE plan with N ops instead of N separate plans. Op types: channel.create, channel.rename, channel.archive, channel.delete, role.create, role.rename, role.delete, member.timeout, member.kick, member.ban. The confirmation panel with buttons is posted to the channel automatically.',
      handler: async (input, ctx) => {
        const { title, ops } = input as { title: string; ops: Array<Record<string, unknown>> };
        return proposePlan(ctx, title, ops);
      },
    },
  ];

  return [...baseTools, ...discordExtraTools(agent, client, { guildOf, noGuild, proposePlan })];
}
