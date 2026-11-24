import { z } from 'zod';
import { defineTool, PipelineStepSchema, validateStepReferences, type BotTool, type ToolResult } from '@10cordes/shared';
import type { SurfaceToolsDeps } from './surface.tools';

const GUILD_REQUIRED = 'Contexte de serveur requis.';

/** Tools trigger.* : planification et annulation de pipelines sur une surface. */
export interface TriggerToolsDeps extends SurfaceToolsDeps {
  /** Prochaine échéance d'une expression cron (null si l'expression est invalide). */
  readonly nextCron: (expression: string) => Date | null;
}

function triggerScheduleTool(deps: TriggerToolsDeps): BotTool {
  return defineTool({
    name: 'trigger.schedule',
    description:
      'Planifie un pipeline sur une surface : once (délai en secondes) ou cron. RATTRAPAGE GARANTI après reboot (plus de fenêtre de grâce : un once manqué s\u0027exécute au boot). cancelKey optionnel pour annulation (trigger.cancelByKey).',
    category: 'surface',
    keywords: ['planifi', 'schedul', 'timer', 'cron', 'rappel', 'reminder', 'délai', 'delai', 'programm'],
    paramsSchema: z.object({
      surfaceId: z.string().min(1).optional(),
      cancelKey: z.string().min(1).max(80).optional(),
      delaySec: z.number().int().min(1).max(86_400 * 90).optional(),
      cron: z.string().min(5).max(60).optional(),
      condition: z.unknown().optional().describe('JSON ConditionSpec évaluée À L\u0027ÉCHÉANCE (ex : state.claimedBy == null)'),
      steps: z.string().min(5).max(8000).describe('JSON ActionPipeline (steps)'),
    }),
    requiredModules: [],
    permissions: ['ManageGuild'],
    destructive: false,
    systemPrompt:
      'TOUS les délais des systèmes passent par ici (jamais setTimeout). Utilise cancelKey prévisible (ex : ticket-esc-{{surfaceId}}) pour permettre l\u0027annulation. La condition est ré-évaluée à l\u0027échéance. Le pipeline planifié s\u0027exécute plus tard avec SES PROPRES étapes seulement : il ne lit jamais les étapes de celui qui l\u0027a créé (passe par l\u0027état).',
    handler: async (input, ctx): Promise<ToolResult> => {
      if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
      const { surfaceId, cancelKey, delaySec, cron, condition, steps: rawSteps } = input as {
        surfaceId?: string;
        cancelKey?: string;
        delaySec?: number;
        cron?: string;
        condition?: unknown;
        steps: string;
      };
      const parsedSteps = z.array(PipelineStepSchema).min(1).max(10).safeParse(JSON.parse(rawSteps));
      if (!parsedSteps.success) return { ok: false, summary: `Steps invalides : ${parsedSteps.error.issues[0]?.message}` };
      // Une référence d'étape fausse rendrait une chaîne vide à l'exécution, sans erreur.
      const references = validateStepReferences(parsedSteps.data, 'pipeline planifié');
      if (references.length > 0) return { ok: false, summary: `Steps refusés : ${references.join(' | ')} Ce pipeline s\u0027exécutera avec ses propres étapes seulement.` };
      if (!delaySec && !cron) return { ok: false, summary: 'delaySec ou cron requis.' };
      if (cancelKey) {
        await deps.prisma.scheduledTrigger.updateMany({ where: { guildId: ctx.guildId, cancelKey, status: 'armed' }, data: { status: 'cancelled' } });
      }
      const runAt = cron ? deps.nextCron(cron) : new Date(Date.now() + (delaySec ?? 60) * 1000);
      // Le LLM passe souvent la condition/steps déjà en STRING JSON : on
      // normalise avant stockage (sinon double sérialisation, spec illisible).
      const conditionValue = typeof condition === 'string' ? JSON.parse(condition) : condition;
      const created = await deps.prisma.scheduledTrigger
        .create({
          data: {
            guildId: ctx.guildId,
            surfaceId: surfaceId ?? null,
            cancelKey: cancelKey ?? null,
            kind: cron ? 'cron' : 'once',
            runAt,
            cron: cron ?? null,
            condition: conditionValue ? JSON.stringify(conditionValue) : null,
            steps: JSON.stringify(parsedSteps.data),
          },
        })
        .catch(() => null);
      if (!created) return { ok: false, summary: 'Création du trigger impossible (cancelKey dupliqué ?).' };
      deps.audit.record({
        guildId: ctx.guildId,
        source: 'agent',
        action: 'trigger.scheduled',
        actorId: ctx.userId,
        metadata: { triggerId: created.id, cancelKey: cancelKey ?? null, kind: cron ? 'cron' : 'once' },
      });
      return {
        ok: true,
        summary: `Trigger ${cron ? `cron « ${cron} »` : `dans ${delaySec}s`} armé${cancelKey ? ` (clé ${cancelKey})` : ''}.`,
        data: { triggerId: created.id },
      };
    },
  });
}

function triggerCancelTool(deps: TriggerToolsDeps): BotTool {
  return defineTool({
    name: 'trigger.cancelByKey',
    description: 'Annule les triggers armés portant cette clé d\u0027annulation (ex : ne pas supprimer un vocal rejoint pendant le délai).',
    category: 'surface',
    keywords: ['annul', 'cancel'],
    paramsSchema: z.object({ cancelKey: z.string().min(1).max(80) }),
    requiredModules: [],
    permissions: ['ManageGuild'],
    destructive: false,
    systemPrompt: 'Réversible : les triggers cancelés restent en DB (status cancelled).',
    handler: async (input, ctx): Promise<ToolResult> => {
      if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
      const { cancelKey } = input as { cancelKey: string };
      const cancelled = await deps.prisma.scheduledTrigger.updateMany({ where: { guildId: ctx.guildId, cancelKey, status: 'armed' }, data: { status: 'cancelled' } });
      return { ok: true, summary: `${cancelled.count} trigger(s) « ${cancelKey} » annulé(s).` };
    },
  });
}

/** Primitives trigger.* de l'agent (ordre d'enregistrement : schedule, cancelByKey). */
export function buildTriggerTools(deps: TriggerToolsDeps): BotTool[] {
  return [triggerScheduleTool(deps), triggerCancelTool(deps)];
}
