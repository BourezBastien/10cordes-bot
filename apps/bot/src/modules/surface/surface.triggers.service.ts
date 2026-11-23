import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Cron } from 'croner';
import { PipelineStepSchema } from '@10cordes/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SurfacePipelineService, type PipelineContext, type PipelineVars, type ToolRunner } from './surface.pipeline';
import { SurfaceService } from './surface.service';
import { runToolAsSystem } from '../../shared/actions/run-tool';
import { Client } from 'discord.js';

const TICK_MS = 15_000;

/**
 * Moteur des ScheduledTrigger : la DB est la source de vérité, le tick
 * exécute les triggers dus. RATTRAPAGE GARANTI : un `once` manqué pendant un
 * arrêt s'exécute AU PREMIER TICK au retour (plus de fenêtre de grâce qui le
 * désactivait silencieusement — bug d'audit). Les `cron` sautent à la
 * prochaine occurrence si elles ont raté plus d'un cycle.
 *
 * Chaque exécution passe par un runner système (runToolAsSystem) et est
 * auditée (scheduled.trigger.run) : traçabilité complète.
 */
@Injectable()
export class SurfaceTriggersService implements SpraxiumOnBoot {
  private readonly log = new Logger('SurfaceTriggers');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pipeline: SurfacePipelineService,
    private readonly surfaces: SurfaceService,
    private readonly client: Client,
  ) {}

  onBoot(): void {
    // Sweep immédiat : rattrapage des once manqués pendant l'arrêt.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    this.log.info('Trigger engine ready (tick 15s, rattrapage garanti sans fenêtre de grâce).');
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const due = await this.prisma.scheduledTrigger.findMany({
        where: { status: 'armed', OR: [{ runAt: { lte: now } }, { runAt: null }] },
        take: 20,
      });
      for (const trigger of due) {
        await this.runTrigger(trigger.id, trigger.guildId, trigger.surfaceId, trigger.kind, trigger.cron, trigger.condition, trigger.steps);
      }
    } catch (error) {
      this.log.warn(`tick : ${(error as Error).message.slice(0, 120)}`);
    } finally {
      this.running = false;
    }
  }

  /** Exécute (ou replanifie) un trigger dû. */
  private async runTrigger(
    triggerId: string,
    guildId: string,
    surfaceId: string | null,
    kind: string,
    cron: string | null,
    conditionJson: string | null,
    stepsJson: string,
  ): Promise<void> {
    const parsed = PipelineStepSchema.array().safeParse(JSON.parse(stepsJson || '[]'));
    if (!parsed.success || parsed.data.length === 0) {
      await this.prisma.scheduledTrigger.update({ where: { id: triggerId }, data: { status: 'cancelled', lastError: 'steps invalides' } });
      return;
    }

    // Récurrence : replanifie AVANT l'exécution (une exécution qui crashe ne
    // re-déclenche pas le même runAt en boucle).
    if (kind === 'cron' && cron) {
      const next = this.pipeline.nextCron(cron);
      await this.prisma.scheduledTrigger.update({ where: { id: triggerId }, data: { runAt: next, lastRunAt: new Date() } }).catch(() => {});
      if (!next) {
        await this.prisma.scheduledTrigger.update({ where: { id: triggerId }, data: { status: 'done' } }).catch(() => {});
        return;
      }
    } else {
      await this.prisma.scheduledTrigger.update({ where: { id: triggerId }, data: { status: 'done', lastRunAt: new Date() } }).catch(() => {});
    }

    // Contexte : état de la surface liée (s'il y en a une), exécution système.
    let state: Record<string, unknown> = {};
    let channelId = '';
    let messageId: string | null = null;
    if (surfaceId) {
      const surface = await this.prisma.interactiveSurface.findUnique({ where: { id: surfaceId } });
      if (surface) {
        state = JSON.parse(surface.state || '{}') as Record<string, unknown>;
        channelId = surface.channelId;
        messageId = surface.messageId;
      }
    }
    const guild = this.client.guilds.cache.get(guildId);
    const botId = this.client.user?.id ?? 'system';
    const vars: PipelineVars = {
      guildId,
      channelId,
      actorId: botId,
      actorName: 'system',
      surfaceId: surfaceId ?? '',
      messageId,
      state,
      steps: [],
      values: {},
    };
    const runTool: ToolRunner = (name, input) =>
      runToolAsSystem(name, input, { guildId, botUserId: botId }).then((result) => ({ ok: result.ok, summary: result.summary }));

    // Condition évaluée À L'ÉCHÉANCE (pas à la planification) : un trigger
    // « passe le bouton au vert SI non claimé » vérifie l'état au moment T.
    if (conditionJson) {
      const passes = await this.pipeline.evaluate(JSON.parse(conditionJson), vars).catch(() => false);
      if (!passes) {
        this.pipeline.auditRun(guildId, 'scheduled.trigger.skipped', botId, { triggerId, reason: 'condition non remplie à l\u0027échéance' });
        return;
      }
    }

    const ctx: PipelineContext = { vars, member: guild?.members.me ?? null, runTool };
    const result = await this.pipeline.executePipeline(parsed.data, ctx);
    if (surfaceId && result.stateChanged) {
      await this.prisma.interactiveSurface.update({ where: { id: surfaceId }, data: { state: JSON.stringify(vars.state) } }).catch(() => {});
    }
    this.pipeline.auditRun(guildId, 'scheduled.trigger.run', botId, {
      triggerId,
      ok: result.ok,
      error: result.error,
      stateChanged: result.stateChanged,
    });
    if (!result.ok) {
      await this.prisma.scheduledTrigger.update({ where: { id: triggerId }, data: { lastError: result.error ?? 'erreur' } }).catch(() => {});
    }
    // Re-render : le pipeline a pu muter l'état / patcher des composants
    // (bouton rouge → vert) — le message Discord se redessine immédiatement.
    if (surfaceId && (result.stateChanged || result.definitionChanged)) {
      await this.surfaces.applyTriggerPatches(surfaceId, vars.steps).catch(() => {});
      await this.surfaces.renderSurface(surfaceId).catch(() => {});
    }
  }
}
