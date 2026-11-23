import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import type { PrismaService } from '../database/prisma.service';

/** Ce dont les tools jobs ont besoin : persistance et tick immédiat du moteur. */
export interface JobsToolsDeps {
  readonly prisma: PrismaService;
  /** Déclenche un tick : un job fraîchement planifié peut déjà être dû. */
  readonly tick: () => Promise<void>;
}

/** Tools jobs.* de l'agent (ordre d'enregistrement : schedule, list, cancel, next). */
export function buildJobsTools(deps: JobsToolsDeps): BotTool[] {
  return [
    {
      name: 'jobs.schedule',
      description:
        'Planifie un job récurrent ou différé : once (à une date/heure), cron (expression, tz Europe/Paris par défaut) ou interval (minutes). Actions = sendMessage (templates {{server.name}}, {{member.count}}) et runTool (n\u0027importe quel tool à l\u0027échéance). Les actions de rôle (addRole/removeRole) n\u0027existent pas ici : un job n\u0027a pas de membre cible ; passe par les automatisations event-driven pour ça.',
      category: 'jobs',
      paramsSchema: z.object({
        name: z.string().min(1).max(60),
        kind: z.enum(['once', 'cron', 'interval']),
        runAtIso: z.string().optional().describe('kind=once : date ISO (ex 2026-11-21T15:00:00Z)'),
        cron: z.string().optional().describe('kind=cron : expression 5 champs (ex "0 9 * * 1")'),
        intervalMinutes: z.number().int().min(5).max(43_200).optional().describe('kind=interval : minutes'),
        actions: z
          .array(
            z.union([
              z.object({ type: z.literal('sendMessage'), channelId: z.string(), content: z.string().min(1).max(1500) }),
              z.object({
                type: z.literal('runTool'),
                name: z.string().min(3).max(40),
                input: z.record(z.string(), z.unknown()).default({}).describe('Paramètres du tool (ex surface.updateComponent : { messageId, description })'),
              }),
            ]),
          )
          .min(1)
          .max(5),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'Pour les rappels et tâches planifiées. Convertis les dates naturelles en ISO (kind=once) ou en cron. Confirme en UNE ligne avec la prochaine exécution.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { name, kind, runAtIso, cron, intervalMinutes, actions } = input as {
          name: string;
          kind: 'once' | 'cron' | 'interval';
          runAtIso?: string;
          cron?: string;
          intervalMinutes?: number;
          actions: Array<{ type: string; channelId?: string; content?: string; roleId?: string }>;
        };
        let runAt: Date | null = null;
        if (kind === 'once') {
          runAt = runAtIso ? new Date(runAtIso) : null;
          if (!runAt || Number.isNaN(runAt.getTime())) return { ok: false, summary: 'runAtIso manquant ou invalide pour kind=once.' };
          if (runAt.getTime() < Date.now()) return { ok: false, summary: 'Cette date est déjà passée.' };
        }
        if (kind === 'cron' && !cron) return { ok: false, summary: 'kind=cron exige une expression cron.' };
        if (kind === 'interval' && !intervalMinutes) return { ok: false, summary: 'kind=interval exige intervalMinutes.' };
        const cleanActions = actions.map((action) => JSON.parse(JSON.stringify(action)));
        await deps.prisma.scheduledJob.upsert({
          where: { guildId_name: { guildId: ctx.guildId, name } },
          create: {
            guildId: ctx.guildId,
            name,
            kind,
            runAt: runAt,
            cron: cron ?? null,
            intervalMinutes: kind === 'interval' ? intervalMinutes ?? null : null,
            actions: JSON.stringify(cleanActions),
          },
          update: { kind, runAt, cron: cron ?? null, intervalMinutes: intervalMinutes ?? null, actions: JSON.stringify(cleanActions), enabled: true, lastError: null },
        });
        void deps.tick();
        return { ok: true, summary: `Job « ${name} » planifié (${kind}) et actif.` };
      },
    },
    {
      name: 'jobs.list',
      description: 'Liste les jobs planifiés du serveur (actifs et leur prochaine exécution).',
      category: 'jobs',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Read-only. En [PANEL] si liste longue.',
      handler: async (_input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const jobs = await deps.prisma.scheduledJob.findMany({ where: { guildId: ctx.guildId } });
        if (jobs.length === 0) return { ok: true, summary: 'Aucun job planifié sur ce serveur.' };
        const lines = jobs.map((job) => {
          const next = job.runAt && job.enabled ? `<t:${Math.floor(job.runAt.getTime() / 1000)}:R>` : 'aucune';
          return `${job.enabled ? '▶️' : '⏸'} ${job.name} (${job.kind}) → next ${next}${job.lastError ? ` · ERREUR: ${job.lastError.slice(0, 40)}` : ''}`;
        });
        return { ok: true, summary: `${jobs.length} job(s) : ${lines.join(' | ')}` };
      },
    },
    {
      name: 'jobs.cancel',
      description: 'Désactive un job planifié (conservé en DB, réactivable avec jobs.schedule au même nom).',
      category: 'jobs',
      paramsSchema: z.object({ name: z.string().min(1).max(60) }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Désactivation réversible.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { name } = input as { name: string };
        const updated = await deps.prisma.scheduledJob.updateMany({
          where: { guildId: ctx.guildId, name },
          data: { enabled: false },
        });
        return updated.count > 0
          ? { ok: true, summary: `Job « ${name} » désactivé.` }
          : { ok: false, summary: `Job « ${name} » introuvable.` };
      },
    },
    {
      name: 'jobs.next',
      description: 'Prochaine exécution d\u0027un job planifié.',
      category: 'jobs',
      paramsSchema: z.object({ name: z.string().min(1).max(60) }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Read-only.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { name } = input as { name: string };
        const job = await deps.prisma.scheduledJob.findFirst({ where: { guildId: ctx.guildId, name } });
        if (!job) return { ok: false, summary: `Job « ${name} » introuvable.` };
        if (!job.enabled) return { ok: true, summary: `Job « ${name} » désactivé.` };
        if (!job.runAt) return { ok: true, summary: `Job « ${name} » sans prochaine exécution.` };
        return {
          ok: true,
          summary: `Job « ${name} » : prochaine exécution <t:${Math.floor(job.runAt.getTime() / 1000)}:R>.`,
        };
      },
    },
  ];
}
