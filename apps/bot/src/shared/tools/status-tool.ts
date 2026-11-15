import type { BotTool } from '@10cordes/shared';
import { z } from 'zod';

/**
 * Tool `x.status` : lecture seule, ManageGuild, disponible même si le module
 * est désactivé (le résumé l'explique) — l'agent répond ainsi aux questions
 * de configuration pour chaque domaine.
 */
export function makeStatusTool(opts: {
  name: string;
  category: string;
  description: string;
  summary: (guildId: string) => Promise<string>;
}): BotTool {
  return {
    name: opts.name,
    description: opts.description,
    category: opts.category,
    paramsSchema: z.object({}).loose(),
    requiredModules: [],
    permissions: ['ManageGuild'],
    destructive: false,
    systemPrompt:
      "Read-only. Call FIRST when the user asks the status, the setup or the configuration of this module.",
    handler: async (_input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const summary = await opts.summary(ctx.guildId);
      return { ok: true, summary, data: { summary } };
    },
  };
}
