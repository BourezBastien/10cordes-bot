import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import type { UtilityToolsDeps } from './utility-resolver';

/** Tool event.schedule : crée un événement Discord planifié natif (onglet Événements du serveur). */
export function eventScheduleTool(deps: UtilityToolsDeps): BotTool {
  const { resolver } = deps;
  return {
    name: 'event.schedule',
    description: 'Crée un événement Discord planifié natif (visible dans l\u0027onglet Événements du serveur).',
    category: 'utility',
    paramsSchema: z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      startAtIso: z.string().min(1),
      durationMinutes: z.number().int().min(15).max(1440).default(60),
      locationChannelId: z.string().optional().describe('Salon vocal de l\u0027événement (optionnel)'),
    }),
    requiredModules: [],
    permissions: ['ManageEvents'],
    destructive: false,
    systemPrompt: 'Événement natif Discord : il apparaît dans l\u0027onglet dédié. Convertis la date en ISO.',
    handler: async (input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const guild = resolver.guildOf(ctx);
      if (!guild) return { ok: false, summary: 'Contexte de serveur requis.' };
      const { name, description, startAtIso, durationMinutes, locationChannelId } = input as {
        name: string;
        description?: string;
        startAtIso: string;
        durationMinutes?: number;
        locationChannelId?: string;
      };
      const start = new Date(startAtIso);
      if (Number.isNaN(start.getTime())) return { ok: false, summary: 'Date ISO invalide.' };
      const end = new Date(start.getTime() + (durationMinutes ?? 60) * 60_000);
      const event = locationChannelId
        ? await guild.scheduledEvents
            .create({
              name,
              description,
              scheduledStartTime: start,
              scheduledEndTime: end,
              entityType: 2,
              channel: locationChannelId,
              privacyLevel: 2,
            })
            .catch(() => null)
        : await guild.scheduledEvents
            .create({
              name,
              description,
              scheduledStartTime: start,
              scheduledEndTime: end,
              entityType: 3,
              privacyLevel: 2,
              entityMetadata: { location: 'En ligne' },
            })
            .catch(() => null);
      if (!event) return { ok: false, summary: 'Création impossible (permissions ManageEvents ?).' };
      return { ok: true, summary: `Événement **${name}** planifié (<t:${Math.floor(start.getTime() / 1000)}:R>).` };
    },
  };
}
