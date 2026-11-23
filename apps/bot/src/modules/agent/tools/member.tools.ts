import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { botPermissionPolicy } from '../../../core/security/bot-permission.policy';
import { guildAdminPolicy, guildAccessContext } from '../../../core/security/access-policy';
import { memberPermissionPolicy } from '../../../core/security/member-permission.policy';
import type { DiscordToolContext } from './tool-context';
import { agentReason } from './tool-context';

/** Tools sur les membres : identité, pseudos, échantillon, message privé, bans. */
export function memberTools(toolCtx: DiscordToolContext): BotTool[] {
  const { guildOf, noGuild } = toolCtx;
  return [
    {
      name: 'setNickname',
      description: "Change le pseudo d\u2019un membre (ou réinitialise si vide). Le pseudo DU BOT : owner du serveur uniquement.",
      category: 'agent',
      paramsSchema: z.object({ userId: z.string().min(1), nickname: z.string().max(32).optional() }),
      requiredModules: [],
      permissions: ['ManageNicknames'],
      destructive: false,
      systemPrompt: 'Tier 2 (reversible) pour les membres. Le pseudo du BOT lui-même est protégé : seul le owner du serveur peut le changer, refuse poliment sinon.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId, nickname } = input as { userId: string; nickname?: string };
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { ok: false, summary: 'Membre introuvable.' };
        // Le pseudo du bot est protégé : owner uniquement (anti-troll).
        const requesterIsOwner = guildAdminPolicy.isOwner(guildAccessContext(guild, ctx.userId, null));
        if (member.id === guild.members.me?.id && !requesterIsOwner) {
          return { ok: false, summary: 'Le pseudo du bot ne peut être changé que par le owner du serveur.' };
        }
        await member.setNickname(nickname ?? null, agentReason(ctx));
        return { ok: true, summary: `Pseudo de <@${userId}> : ${nickname ?? 'réinitialisé'}.` };
      },
    },
    {
      name: 'getMemberInfo',
      description: 'Infos d\u2019un membre : pseudo, rôles, admin ou non.',
      category: 'agent',
      paramsSchema: z.object({ userId: z.string().min(1) }),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt: 'Read-only. Utilise-le pour connaître le périmètre réel d\u2019un membre.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId } = input as { userId: string };
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { ok: false, summary: 'Membre introuvable (ou absent du serveur).' };
        const roles = member.roles.cache.filter((r) => r.id !== guild.id).map((r) => `<@&${r.id}>`).slice(0, 15);
        return {
          ok: true,
          summary: `${member.displayName} (<@${member.id}>) : ${member.roles.cache.size - 1} rôle(s) : ${roles.join(' ') || 'aucun'}. Admin : ${memberPermissionPolicy.isAdmin(member) ? 'oui' : 'non'}.`,
          data: { id: member.id, nickname: member.displayName, roleCount: member.roles.cache.size - 1 },
        };
      },
    },
    {
      name: 'getMembers',
      description: 'Échantillon des membres du serveur (max 25).',
      category: 'agent',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: [],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (_input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const members = guild.members.cache.first(25).map((m) => `${m.displayName} (<@${m.id}>)`);
        return { ok: true, summary: `${guild.memberCount} membres au total. Échantillon : ${members.join(', ')}` };
      },
    },
    {
      name: 'sendDirectMessage',
      description: 'Envoie un message privé à un membre (max 1200 caractères).',
      category: 'agent',
      paramsSchema: z.object({ userId: z.string().min(1), content: z.string().min(1).max(1200) }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Prévient un membre discrètement. Les MP fermés renvoient une erreur claire.',
      handler: async (input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        const { userId, content } = input as { userId: string; content: string };
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { ok: false, summary: 'Membre introuvable.' };
        await member.send({ content: `📨 De <@${ctx.userId}> : ${content}` });
        return { ok: true, summary: `MP envoyé à <@${userId}>.` };
      },
    },
    {
      name: 'getBans',
      description: 'Liste les bans actifs du serveur.',
      category: 'agent',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: ['BanMembers'],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (_input, ctx) => {
        const guild = guildOf(ctx);
        if (!guild) return noGuild();
        if (!botPermissionPolicy.canInGuild(guild, 'BanMembers')) {
          return { ok: false, summary: botPermissionPolicy.refusal('BanMembers') };
        }
        const bans = await guild.bans.fetch();
        const lines = bans
          .map((b) => `<@${b.user.id}> (${b.user.username})${b.reason ? ` : ${b.reason.slice(0, 60)}` : ''}`)
          .slice(0, 15);
        return { ok: true, summary: `${bans.size} ban(s) : ${lines.join(' | ') || 'aucun'}` };
      },
    },
  ];
}
