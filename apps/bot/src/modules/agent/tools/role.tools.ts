import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { botPermissionPolicy } from '../../../core/security/bot-permission.policy';
import { guildAdminPolicy, guildAccessContext } from '../../../core/security/access-policy';
import { memberPermissionPolicy } from '../../../core/security/member-permission.policy';
import type { DiscordToolContext } from './tool-context';
import { agentReason } from './tool-context';
import { withPreState } from './tool-support';

/** Tools sur les rôles et les sanctions de membres (timeout, unban). */
export function roleTools(toolCtx: DiscordToolContext): BotTool[] {
  const { guildOf, noGuild } = toolCtx;
  return [
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
        if (!botPermissionPolicy.canInGuild(guild, 'ManageRoles')) {
          return { ok: false, summary: botPermissionPolicy.refusal('ManageRoles') };
        }
        const role = await guild.roles.create({ name, color, reason: agentReason(ctx) });
        return { ok: true, summary: `Rôle **${name}** créé → <@&${role.id}>`, data: { roleId: role.id } };
      },
    },
    {
      name: 'renameRole',
      description: 'Renomme un rôle.',
      category: 'agent',
      paramsSchema: z.object({ roleId: z.string().min(1), name: z.string().min(1).max(100) }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). Resolve the role via role.list first.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { roleId, name } = input as { roleId: string; name: string };
        const role = guild.roles.cache.get(roleId);
        if (!role) return { ok: false, summary: 'Rôle introuvable.' };
        const oldName = role.name;
        await role.setName(name, agentReason(ctx));
        return withPreState({ ok: true, summary: `Rôle renommé en **${name}**.` }, { roleId, oldName });
      },
    },
    {
      name: 'setRoleColor',
      description: "Change la couleur d'un rôle (entier hex : rouge=16711680, vert=65280, bleu=255).",
      category: 'agent',
      paramsSchema: z.object({ roleId: z.string().min(1), color: z.number().int().min(0).max(0xffffff) }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible). Convertis les couleurs nommées en entier hex toi-même.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { roleId, color } = input as { roleId: string; color: number };
        const role = guild.roles.cache.get(roleId);
        if (!role) return { ok: false, summary: 'Rôle introuvable.' };
        await role.setColor(color, agentReason(ctx));
        return { ok: true, summary: `Couleur de **${role.name}** mise à jour.` };
      },
    },
    {
      name: 'addRoleToMember',
      description: 'Attribue un rôle à un membre.',
      category: 'agent',
      paramsSchema: z.object({ userId: z.string().min(1), roleId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: false,
      systemPrompt: 'Tier 2. Le bot doit être au-dessus du rôle et du membre.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId, roleId } = input as { userId: string; roleId: string };
        const member = await guild.members.fetch(userId).catch(() => null);
        const role = guild.roles.cache.get(roleId);
        if (!member || !role) return { ok: false, summary: 'Membre ou rôle introuvable.' };
        await member.roles.add(role, agentReason(ctx));
        return { ok: true, summary: `<@&${roleId}> attribué à <@${userId}>.` };
      },
    },
    {
      name: 'removeRoleFromMember',
      description: 'Retire un rôle à un membre.',
      category: 'agent',
      paramsSchema: z.object({ userId: z.string().min(1), roleId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible via role.add).',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId, roleId } = input as { userId: string; roleId: string };
        const member = await guild.members.fetch(userId).catch(() => null);
        const role = guild.roles.cache.get(roleId);
        if (!member || !role) return { ok: false, summary: 'Membre ou rôle introuvable.' };
        await member.roles.remove(role, agentReason(ctx));
        return { ok: true, summary: `<@&${roleId}> retiré à <@${userId}>.` };
      },
    },
    {
      name: 'getRoleMembers',
      description: 'Liste les membres qui portent un rôle (max 25 mentions).',
      category: 'agent',
      paramsSchema: z.object({ roleId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { roleId } = input as { roleId: string };
        const role = guild.roles.cache.get(roleId);
        if (!role) return { ok: false, summary: 'Rôle introuvable.' };
        const members = role.members.map((m) => `<@${m.id}>`).slice(0, 25);
        return { ok: true, summary: `${role.members.size} membre(s) avec <@&${roleId}> : ${members.join(' ') || 'aucun'}` };
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
          if (!memberPermissionPolicy.has(requester, 'ModerateMembers')) {
            return { ok: false, summary: 'Permission ModerateMembers requise pour le demandeur.' };
          }
          const requesterIsOwner = guildAdminPolicy.isOwner(guildAccessContext(guild, ctx.userId, requester));
          if (!requesterIsOwner && member.roles.highest.comparePositionTo(requester.roles.highest) >= 0) {
            return { ok: false, summary: 'Le demandeur a un rôle inférieur ou égal à la cible.' };
          }
        }
        if (member.roles.highest.comparePositionTo(me.roles.highest) >= 0) {
          return { ok: false, summary: 'Le bot a un rôle inférieur ou égal à la cible.' };
        }
        await member.timeout(durationMs, reason ?? agentReason(ctx));
        return { ok: true, summary: `Timeout de ${Math.round(durationMs / 60_000)} min appliqué à <@${userId}>.` };
      },
    },
    {
      name: 'unbanMember',
      description: 'Déban un utilisateur par ID.',
      category: 'agent',
      paramsSchema: z.object({ userId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['BanMembers'],
      destructive: false,
      systemPrompt: 'Tier 2. Reversal of a ban.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId } = input as { userId: string };
        if (!botPermissionPolicy.canInGuild(guild, 'BanMembers')) {
          return { ok: false, summary: botPermissionPolicy.refusal('BanMembers') };
        }
        await guild.members.unban(userId, agentReason(ctx));
        return { ok: true, summary: `<@${userId}> débanni.` };
      },
    },
  ];
}
