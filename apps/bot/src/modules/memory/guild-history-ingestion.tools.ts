import { z } from 'zod';
import { defineTool, type BotTool } from '@10cordes/shared';
import type { GuildHistoryIngestionService } from './guild-history-ingestion.service';

/**
 * Tools de l'ingestion historique (B1) : relance manuelle (ManageGuild) et
 * statut. L'ingestion elle-même est automatique au premier join du bot.
 */

export function buildIngestionTools(service: GuildHistoryIngestionService): BotTool[] {
  return [
    defineTool({
      name: 'guild.ingestHistory',
      description:
        'Ingestion de l\u0027historique du serveur : lit les derniers messages des salons lisibles et distille culture, ton, vocabulaire, rôle des salons et règles implicites vers la mémoire du bot. Lancement en tâche de fond (non bloquant). Refait automatiquement au premier join du bot ; ce tool sert de relance manuelle.',
      category: 'memory',
      paramsSchema: z.object({
        force: z.boolean().optional().describe('true = ré-ingérer même si déjà fait (réinitialise la progression)'),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'Propose ce tool quand l\u0027admin veut que le bot « connaisse » le serveur ou apprenne son historique. Explique que ça tourne en fond et peut prendre quelques minutes. Statut vérifiable avec guild.ingestStatus.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const result = await service.trigger(ctx.guildId, { force: input.force === true, actorId: ctx.userId });
        if (ctx.progress) await ctx.progress('Ingestion : démarrage…');
        switch (result.status) {
          case 'started':
            return { ok: true, summary: 'Ingestion lancée en tâche de fond : lecture des salons puis distillation. Statut via guild.ingestStatus.' };
          case 'already-running':
            return { ok: true, summary: 'Une ingestion est déjà en cours sur ce serveur.' };
          case 'llm-missing':
            return { ok: false, summary: 'Aucun fournisseur IA connecté : connecte-le d\u0027abord (bouton sur le panneau d\u0027accueil).' };
          default:
            return { ok: false, summary: `Ingestion non lancée : ${result.reason}.` };
        }
      },
    }),
    defineTool({
      name: 'guild.ingestStatus',
      description: 'Statut de l\u0027ingestion de l\u0027historique du serveur (en cours, salons traités, erreurs).',
      category: 'memory',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (_input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const status = await service.status(ctx.guildId);
        if (status.total === 0) return { ok: true, summary: 'Aucune ingestion enregistrée sur ce serveur.' };
        return {
          ok: true,
          summary: `Ingestion : ${status.running ? 'EN COURS' : 'inactive'} · ${status.done}/${status.total} salons traités · ${status.errors} erreur(s).`,
        };
      },
    }),
  ];
}
