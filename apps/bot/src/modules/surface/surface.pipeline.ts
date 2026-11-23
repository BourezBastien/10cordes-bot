import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Cron } from 'croner';
import { randomInt } from 'node:crypto';
import { Client } from 'discord.js';
import { z } from 'zod';
import { PipelineStepSchema, type InteractionBinding, type PipelineStep, type SurfaceDefinition } from '@10cordes/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CacheStoreService } from '../../shared/cache/cache-store.service';
import { getLlm } from '../assistant/llm.accessor';
import { BindingAccessPolicy } from './pipeline-access.policy';
import { ConditionEvaluator } from './pipeline-condition.evaluator';
import { PipelineInterpolator } from './pipeline-interpolation';
import type { PipelineContext, PipelineResult, PipelineVars } from './pipeline.types';

export type { PipelineContext, PipelineResult, PipelineVars, ToolRunner } from './pipeline.types';

const MAX_TOTAL_STEPS = 40;

/**
 * Exécuteur d'ActionPipeline (Command + Composite). Un pipeline s'exécute
 * avec des VARIABLES interpolées, un RUNNER de tools (l'acteur pour un clic,
 * le système pour un trigger) et un état persisté en amont après chaque
 * mutation. L'interpolation, l'évaluation des conditions et la policy d'accès
 * des bindings sont confiées à des collaborateurs à responsabilité unique.
 */
@Injectable()
export class SurfacePipelineService {
  private readonly log = new Logger('SurfacePipeline');
  private readonly interpolator = new PipelineInterpolator();
  private readonly evaluator: ConditionEvaluator;
  private readonly access: BindingAccessPolicy;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: CacheStoreService,
    private readonly client: Client,
  ) {
    this.evaluator = new ConditionEvaluator({ prisma, client, cache, interpolator: this.interpolator });
    this.access = new BindingAccessPolicy({ cache, evaluator: this.evaluator });
  }

  interpolate(text: string, vars: PipelineVars): string {
    return this.interpolator.interpolate(text, vars);
  }

  evaluate(spec: unknown, vars: PipelineVars): Promise<boolean> {
    return this.evaluator.evaluate(spec, vars);
  }

  checkAccess(binding: InteractionBinding, ctx: PipelineContext): Promise<{ allowed: boolean; deny?: string }> {
    return this.access.checkAccess(binding, ctx);
  }

  /** Prochaine échéance d'une expression cron (heure de Paris), null si invalide. */
  nextCron(expression: string): Date | null {
    try {
      const job = new Cron(expression, { timezone: 'Europe/Paris' });
      const next = job.nextRun() ?? null;
      job.stop();
      return next;
    } catch {
      return null;
    }
  }

  /** Audit dédié aux exécutions du moteur (traçabilité BullMQ/handler). */
  auditRun(guildId: string, action: string, actorId: string, metadata: Record<string, unknown>): void {
    this.audit.record({ guildId, source: 'agent', action, actorId, metadata });
  }

  async executePipeline(steps: readonly unknown[], ctx: PipelineContext, depth = 0): Promise<PipelineResult> {
    const result: PipelineResult = { ok: true, replyEphemeral: null, openModal: null, error: null, stateChanged: false, definitionChanged: false };
    let executed = 0;
    try {
      for (const raw of steps) {
        if (executed >= MAX_TOTAL_STEPS) break;
        const parsed = PipelineStepSchema.safeParse(raw);
        if (!parsed.success) continue;
        executed += 1;
        const step = parsed.data as PipelineStep;
        const stepResult: Record<string, unknown> = {};
        switch (step.type) {
          case 'runTool': {
            const interpolatedInput = this.interpolator.deepInterpolate(step.input, ctx.vars);
            const toolResult = await ctx.runTool(step.name, interpolatedInput);
            stepResult.ok = toolResult.ok;
            stepResult.summary = toolResult.summary.slice(0, 300);
            Object.assign(stepResult, toolResult.data ?? {});
            if (!toolResult.ok) result.error ??= toolResult.summary.slice(0, 160);
            break;
          }
          case 'setState': {
            // La valeur peut référencer le résultat d'une étape ({{steps.N.value}})
            // ou l'état ({{state.x}}) : le type de la cible est conservé.
            this.interpolator.setPath(ctx.vars.state, step.path, this.interpolator.resolveValue(step.value, ctx.vars), step.mode);
            stepResult.path = step.path;
            result.stateChanged = true;
            break;
          }
          case 'updateComponent': {
            stepResult.binding = step.binding;
            stepResult.patch = step.patch;
            result.definitionChanged = true;
            break;
          }
          case 'sendMessage': {
            const targetChannel = step.channelId ? this.interpolator.interpolate(step.channelId, ctx.vars) : ctx.vars.channelId;
            const channel = await this.client.channels.fetch(targetChannel).catch(() => null);
            const content = this.interpolator.interpolate(step.content, ctx.vars).slice(0, 1900);
            const sent = channel?.isTextBased() && 'send' in channel
              ? await channel.send({ content }).then(() => true).catch(() => false)
              : false;
            stepResult.sent = sent;
            break;
          }
          case 'replyEphemeral': {
            result.replyEphemeral = this.interpolator.interpolate(step.content, ctx.vars).slice(0, 1000);
            stepResult.ephemeral = true;
            break;
          }
          case 'openModal': {
            result.openModal = step.modal;
            stepResult.modal = step.modal.title;
            break;
          }
          case 'record.write': {
            const data = this.interpolator.deepInterpolate(step.data, ctx.vars) as Record<string, unknown>;
            await this.prisma.agentRecord.create({
              data: {
                guildId: ctx.vars.guildId,
                collection: step.collection,
                channelId: ctx.vars.channelId,
                messageId: ctx.vars.messageId,
                createdBy: ctx.vars.actorId,
                data: JSON.stringify({ version: 1, ...data }),
              },
            });
            stepResult.written = step.collection;
            break;
          }
          case 'trigger.schedule': {
            const stepsJson = JSON.stringify(step.steps);
            const runAt = step.delaySec ? new Date(Date.now() + step.delaySec * 1000) : null;
            if (step.key) {
              await this.prisma.scheduledTrigger.updateMany({
                where: { guildId: ctx.vars.guildId, cancelKey: step.key, status: 'armed' },
                data: { status: 'cancelled' },
              });
            }
            await this.prisma.scheduledTrigger.create({
              data: {
                guildId: ctx.vars.guildId,
                surfaceId: ctx.vars.surfaceId,
                cancelKey: step.key ? this.interpolator.interpolate(step.key, ctx.vars) : null,
                kind: step.cron ? 'cron' : 'once',
                runAt: step.cron ? this.nextCron(step.cron) : runAt,
                cron: step.cron ?? null,
                condition: step.condition ? JSON.stringify(step.condition) : null,
                steps: stepsJson,
              },
            });
            stepResult.scheduled = step.key ?? 'anon';
            break;
          }
          case 'trigger.cancelByKey': {
            const cancelled = await this.prisma.scheduledTrigger.updateMany({
              where: { guildId: ctx.vars.guildId, cancelKey: this.interpolator.interpolate(step.key, ctx.vars), status: 'armed' },
              data: { status: 'cancelled' },
            });
            stepResult.cancelled = cancelled.count;
            break;
          }
          case 'random': {
            // crypto randomInt : les tirages alimentent des jeux/giveaways
            // à valeur réelle, jamais Math.random (prédictible).
            const min = Math.min(step.min, step.max);
            const max = Math.max(step.min, step.max);
            const value = randomInt(min, max + 1);
            stepResult.value = value;
            break;
          }
          case 'llm': {
            const prompt = this.interpolator.interpolate(step.prompt, ctx.vars);
            const completion = await getLlm()
              .chat([{ role: 'user', content: prompt }], [], { userId: ctx.vars.actorId, guildId: ctx.vars.guildId, cause: 'consolidation' })
              .catch(() => null);
            const text = (completion?.content ?? '').slice(0, step.maxChars);
            stepResult.text = text;
            // saveTo : le résultat (JSON si demandé) est rangé dans l'état, et
            // le panneau le montre au re-rendu ({{state.<saveTo>...}}).
            if (step.saveTo) {
              this.interpolator.setPath(ctx.vars.state, step.saveTo, step.parseJson ? this.interpolator.parseJsonLenient(text) : text, 'set');
              result.stateChanged = true;
            }
            break;
          }
          case 'if': {
            const branch = await this.evaluator.evaluate(step.condition, ctx.vars);
            const nested = await this.executePipeline(branch ? step.then : (step.else ?? []), ctx, depth + 1);
            this.mergeNested(result, nested);
            break;
          }
          case 'forEach': {
            const over: Array<Record<string, unknown>> = [];
            if (step.over === 'roleMembers' && step.roleId) {
              const guild = this.client.guilds.cache.get(ctx.vars.guildId);
              const role = guild?.roles.cache.get(step.roleId);
              if (role) {
                for (const [id] of role.members) {
                  over.push({ id });
                  if (over.length >= step.limit) break;
                }
              }
            } else if (step.over === 'records' && step.collection) {
              const rows = await this.prisma.agentRecord.findMany({
                where: { guildId: ctx.vars.guildId, collection: step.collection },
                take: step.limit,
                orderBy: { createdAt: 'desc' },
              });
              for (const row of rows) {
                try {
                  over.push(JSON.parse(row.data) as Record<string, unknown>);
                } catch {
                  /* record illisible */
                }
              }
            }
            for (const item of over) {
              const itemVars: PipelineVars = { ...ctx.vars, values: { ...ctx.vars.values, [step.as]: JSON.stringify(item) } };
              const nested = await this.executePipeline(step.steps, { ...ctx, vars: itemVars }, depth + 1);
              this.mergeNested(result, nested);
            }
            break;
          }
          case 'claimOnce': {
            const key = this.interpolator.interpolate(step.key, ctx.vars);
            const won = await this.cache.active.claimOnce(`claim:${ctx.vars.guildId}:${key}`, ctx.vars.actorId, step.ttlSec);
            stepResult[step.winnerVar] = won;
            if (!won) result.error ??= 'Déjà réclamé.';
            break;
          }
        }
        ctx.vars.steps.push(stepResult);
      }
    } catch (error) {
      result.ok = false;
      result.error = error instanceof Error ? error.message.slice(0, 160) : String(error);
      this.log.warn(`pipeline : ${result.error}`);
    }
    return result;
  }

  private mergeNested(target: PipelineResult, nested: PipelineResult): void {
    if (!nested.ok) target.ok = false;
    if (nested.replyEphemeral) target.replyEphemeral = nested.replyEphemeral;
    if (nested.openModal) target.openModal = nested.openModal;
    if (nested.error && !target.error) target.error = nested.error;
    target.stateChanged ||= nested.stateChanged;
    target.definitionChanged ||= nested.definitionChanged;
  }
}

/** Schéma utilitaire exporté pour les consumers (validation runtime). */
export const SurfaceDefinitionCheck = z.custom<SurfaceDefinition>();
