import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import type { ServerlifeToolsDeps } from './serverlife.tool-deps';

/**
 * Tools de la vie sociale des membres : statut AFK, anniversaires et rôles
 * sticky (ré-attribués au retour d'un membre).
 */

/** Tool afk.set : passe un membre en AFK avec une raison. */
export function afkSetTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'afk.set',
    description: 'Passe un membre en AFK avec raison : à son retour ou quand on le mentionne, le bot l\u0027explique.',
    category: 'serverlife',
    paramsSchema: z.object({
      reason: z.string().min(2).max(200).default('absent'),
      userId: z.string().min(1).optional().describe('Par défaut soi-même'),
    }),
    requiredModules: [],
    destructive: false,
    systemPrompt: 'L\u0027utilisateur peut se mettre AFK lui-même ; un staff peut le faire pour quelqu\u0027un.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { reason, userId } = input as { reason?: string; userId?: string };
      const target = userId ?? ctx.userId;
      await deps.prisma.afkStatus.upsert({
        where: { guildId_userId: { guildId: ctx.guildId, userId: target } },
        create: { guildId: ctx.guildId, userId: target, reason: reason ?? 'absent' },
        update: { reason: reason ?? 'absent', since: new Date() },
      });
      return { ok: true, summary: `<@${target}> est maintenant AFK (${reason ?? 'absent'}).` };
    },
  };
}

/** Tool afk.clear : retire le statut AFK d'un membre. */
export function afkClearTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'afk.clear',
    description: 'Retire le statut AFK d\u0027un membre.',
    category: 'serverlife',
    paramsSchema: z.object({ userId: z.string().min(1).optional().describe('Par défaut soi-même') }),
    requiredModules: [],
    destructive: false,
    systemPrompt: 'Retour de vacances ou erreur.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { userId } = input as { userId?: string };
      const target = userId ?? ctx.userId;
      await deps.prisma.afkStatus.deleteMany({ where: { guildId: ctx.guildId, userId: target } });
      return { ok: true, summary: `<@${target}> n\u0027est plus AFK.` };
    },
  };
}

/** Tool birthday.set : enregistre la date d'anniversaire d'un membre. */
export function birthdaySetTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'birthday.set',
    description: 'Enregistre un anniversaire (format MM-DD) : annoncé dans le salon système le jour J.',
    category: 'serverlife',
    paramsSchema: z.object({
      date: z.string().regex(/^\d{2}-\d{2}$/u, 'Format MM-DD'),
      userId: z.string().min(1).optional().describe('Par défaut soi-même'),
    }),
    requiredModules: [],
    destructive: false,
    systemPrompt: 'Format strict MM-DD (ex : 07-14). Le jour J, le bot annonce dans le salon système.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { date, userId } = input as { date: string; userId?: string };
      const target = userId ?? ctx.userId;
      await deps.prisma.memberBirthday.upsert({
        where: { guildId_userId: { guildId: ctx.guildId, userId: target } },
        create: { guildId: ctx.guildId, userId: target, date },
        update: { date },
      });
      return { ok: true, summary: `Anniversaire de <@${target}> enregistré : ${date}.` };
    },
  };
}

/** Tool birthday.list : liste les anniversaires du serveur, triés par date. */
export function birthdayListTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'birthday.list',
    description: 'Liste les anniversaires du serveur (triés par date).',
    category: 'serverlife',
    paramsSchema: z.object({}),
    requiredModules: [],
    destructive: false,
    systemPrompt: 'Read-only.',
    handler: async (_input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const rows = await deps.prisma.memberBirthday.findMany({
        where: { guildId: ctx.guildId },
        orderBy: { date: 'asc' },
      });
      if (rows.length === 0) return { ok: true, summary: 'Aucun anniversaire enregistré.' };
      const lines = rows.map((row) => `${row.date} → <@${row.userId}>`);
      return { ok: true, summary: `${rows.length} anniversaire(s) : ${lines.join(' | ')}` };
    },
  };
}

/** Tool sticky.role.add : rend un rôle sticky pour un membre. */
export function stickyRoleAddTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'sticky.role.add',
    description: 'Rend un rôle sticky pour un membre : ré-attribué automatiquement à son retour sur le serveur.',
    category: 'serverlife',
    paramsSchema: z.object({ roleId: z.string().min(1), userId: z.string().min(1).optional() }),
    requiredModules: [],
    permissions: ['ManageRoles'],
    destructive: false,
    systemPrompt: 'Sticky = persiste même après un leave/rejoin.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { roleId, userId } = input as { roleId: string; userId?: string };
      const target = userId ?? ctx.userId;
      await deps.prisma.stickyRole.upsert({
        where: { guildId_userId_roleId: { guildId: ctx.guildId, userId: target, roleId } },
        create: { guildId: ctx.guildId, userId: target, roleId },
        update: {},
      });
      return { ok: true, summary: `Rôle <@&${roleId}> rendu sticky pour <@${target}>.` };
    },
  };
}

/** Tool sticky.role.remove : retire un rôle sticky d'un membre. */
export function stickyRoleRemoveTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'sticky.role.remove',
    description: 'Retire un rôle sticky d\u0027un membre.',
    category: 'serverlife',
    paramsSchema: z.object({ roleId: z.string().min(1), userId: z.string().min(1).optional() }),
    requiredModules: [],
    permissions: ['ManageRoles'],
    destructive: false,
    systemPrompt: 'Arrête la ré-attribution automatique.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { roleId, userId } = input as { roleId: string; userId?: string };
      const target = userId ?? ctx.userId;
      await deps.prisma.stickyRole.deleteMany({ where: { guildId: ctx.guildId, userId: target, roleId } });
      return { ok: true, summary: `Rôle <@&${roleId}> n\u0027est plus sticky pour <@${target}>.` };
    },
  };
}
