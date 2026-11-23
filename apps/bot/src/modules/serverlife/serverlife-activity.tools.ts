import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { summarizeActivity } from './activity-stats';
import type { ServerlifeToolsDeps } from './serverlife.tool-deps';

/** Tools de mesure de l'activité (messages, temps vocal) : rang, top et résumé, en lecture seule. */

/** Tool member.rank : rang d'activité d'un membre sur le serveur. */
export function memberRankTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'member.rank',
    description: 'Rang d\u0027activité d\u0027un membre (messages + temps vocal) sur le serveur.',
    category: 'serverlife',
    paramsSchema: z.object({ userId: z.string().min(1).optional().describe('Par défaut soi-même') }),
    requiredModules: [],
    destructive: false,
    systemPrompt: 'Read-only. Activité mesurée depuis l\u0027activation du module.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { userId } = input as { userId?: string };
      const target = userId ?? ctx.userId;
      const me = await deps.prisma.memberActivity.findUnique({
        where: { guildId_userId: { guildId: ctx.guildId, userId: target } },
      });
      const all = await deps.prisma.memberActivity.findMany({
        where: { guildId: ctx.guildId },
        orderBy: [{ messages: 'desc' }, { voiceMinutes: 'desc' }],
      });
      const rank = all.findIndex((row) => row.userId === target) + 1;
      if (!me) return { ok: true, summary: `<@${target}> : aucune activité enregistrée (rang inconnu).` };
      return {
        ok: true,
        summary: `<@${target}> : ${me.messages} message(s), ${me.voiceMinutes} min de vocal : rang ${rank}/${all.length}.`,
        data: { rank, total: all.length },
      };
    },
  };
}

/** Tool server.top : membres les plus actifs du serveur. */
export function serverTopTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'server.top',
    description: 'Top activité du serveur : membres les plus actifs (messages + vocal).',
    category: 'serverlife',
    paramsSchema: z.object({ limit: z.number().int().min(3).max(15).default(10) }),
    requiredModules: [],
    destructive: false,
    systemPrompt: 'Read-only. Liste en [PANEL] si demandé publiquement.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { limit } = input as { limit?: number };
      const rows = await deps.prisma.memberActivity.findMany({
        where: { guildId: ctx.guildId },
        orderBy: [{ messages: 'desc' }, { voiceMinutes: 'desc' }],
        take: limit ?? 10,
      });
      if (rows.length === 0) return { ok: true, summary: 'Aucune activité enregistrée pour le moment.' };
      const lines = rows.map((row, index) => `${index + 1}. <@${row.userId}> : ${row.messages} msg, ${row.voiceMinutes} min vocal`);
      return { ok: true, summary: `Top activité : ${lines.join(' | ')}` };
    },
  };
}

/** Tool activity.summary : résumé d'activité du serveur sur une fenêtre, en SQL agrégé. */
export function activitySummaryTool(deps: ServerlifeToolsDeps): BotTool {
  return {
    name: 'activity.summary',
    description:
      "Résumé d'activité du serveur en SQL pur (rapide) : volume de messages/jour, joins/leaves, top membres sur la fenêtre (minutes de vocal en cumul), avec coverageSince (date du plus ancien événement compté : indique la profondeur de données réelle). Pour les rapports hebdo et les moyennes/jour.",
    category: 'serverlife',
    paramsSchema: z.object({
      days: z.number().int().min(1).max(90).default(7).describe('Fenêtre en jours (défaut 7)'),
    }),
    requiredModules: [],
    permissions: [],
    destructive: false,
    systemPrompt:
      "Read-only et rapide (SQL agrégé, pas de scan Discord). Cite TOUJOURS coverageSince dans ton rapport : une moyenne/jour n'a de sens que sur la profondeur réelle des données.",
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const days = (input as { days?: number }).days ?? 7;
      return summarizeActivity(deps.prisma, ctx.guildId, days);
    },
  };
}
