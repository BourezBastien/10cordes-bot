import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import type { PrismaService } from '../database/prisma.service';

/** Ce dont les tools de modération ont besoin : l'accès au dossier des cases. */
export interface ModerationToolsDeps {
  readonly prisma: PrismaService;
}

/** Tool getCases : lecture seule des cases de modération du serveur. */
export function buildModerationTools(deps: ModerationToolsDeps): BotTool[] {
  return [
    {
      name: 'getCases',
      description:
        'Lit les cases de modération du serveur : filtres par action (warn/timeout/kick/ban/unban/derank/purge) et nombre de jours. Renvoie case #, membre, modérateur, raison, date.',
      category: 'moderation',
      paramsSchema: z.object({
        action: z.enum(['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'derank', 'purge']).optional(),
        days: z.number().int().min(1).max(365).default(30),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'Read-only. Répond à « qui a été ban ce mois-ci », « liste les warns », etc. Cite la case #, le membre, le modérateur et la date de chaque entrée.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { action, days, limit } = input as { action?: string; days?: number; limit?: number };
        const since = new Date(Date.now() - (days ?? 30) * 24 * 60 * 60 * 1000);
        const cases = await deps.prisma.modCase.findMany({
          where: {
            guildId: ctx.guildId,
            ...(action ? { action } : {}),
            createdAt: { gte: since },
          },
          orderBy: { createdAt: 'desc' },
          take: limit ?? 10,
        });
        if (cases.length === 0) return { ok: true, summary: `Aucune case de modération sur les ${days ?? 30} derniers jours.` };
        const lines = cases.map(
          (entry) =>
            `case #${entry.caseId} [${entry.action}] <@${entry.userId}> par <@${entry.moderatorId}> le ${entry.createdAt.toLocaleString('fr-FR')}${entry.reason ? ` : ${entry.reason}` : ''}`,
        );
        return { ok: true, summary: `${cases.length} case(s) : ${lines.join(' | ')}`, data: { count: cases.length } };
      },
    },
  ];
}
