import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Cron } from 'croner';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CacheStoreService } from '../../shared/cache/cache-store.service';
import { getLlm } from '../assistant/llm.accessor';
import {
  ConditionSpecSchema,
  PipelineStepSchema,
  type ConditionSpec,
  type InteractionBinding,
  type PipelineStep,
  type SurfaceDefinition,
} from '@10cordes/shared';
import { Client } from 'discord.js';
import type { GuildMember } from 'discord.js';
import { z } from 'zod';

/**
 * Exécuteur d'ActionPipeline (Command + Composite) et évaluateur de
 * ConditionSpec (Specification). Un pipeline s'exécute avec :
 * - des VARIABLES interpolées ({{actor.id}}, {{state.x}}, {{steps.n.field}}) ;
 * - un RUNNER de tools (l'acteur pour un clic, le système pour un trigger) ;
 * - l'état de la surface persisté APRÈS chaque mutation (re-render amont).
 */

export interface PipelineVars {
  guildId: string;
  channelId: string;
  actorId: string;
  actorName: string;
  surfaceId: string;
  messageId: string | null;
  state: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  values: Record<string, string | number | boolean | null>;
  modalValues?: Record<string, string>;
  selectedValues?: string[];
  event?: Record<string, unknown>;
}

export type ToolRunner = (name: string, input: unknown) => Promise<{ ok: boolean; summary: string; data?: Record<string, unknown> }>;

export interface PipelineContext {
  vars: PipelineVars;
  runTool: ToolRunner;
  member: GuildMember | null;
}

export interface PipelineResult {
  ok: boolean;
  replyEphemeral: string | null;
  openModal: import('@10cordes/shared').ModalSpec | null;
  error: string | null;
  stateChanged: boolean;
  definitionChanged: boolean;
}

const MAX_TOTAL_STEPS = 40;

@Injectable()
export class SurfacePipelineService {
  private readonly log = new Logger('SurfacePipeline');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: CacheStoreService,
    private readonly client: Client,
  ) {}

  // ── Interpolation ────────────────────────────────────────────────

  interpolate(text: string, vars: PipelineVars): string {
    return text.replace(/\{\{([^}]+)\}\}/gu, (_match, rawPath: string) => {
      const path = rawPath.trim();
      if (path === 'actor.id') return vars.actorId;
      if (path === 'actor.username') return vars.actorName;
      if (path === 'guild.id') return vars.guildId;
      if (path === 'surface.channelId') return vars.channelId;
      if (path === 'surface.messageId') return vars.messageId ?? '';
      if (path.startsWith('state.')) return String(this.pick(vars.state, path.slice(6)) ?? '');
      if (path.startsWith('steps.')) {
        const [index, field] = path.slice(6).split('.');
        const step = vars.steps[Number(index)];
        return step ? String(step[field] ?? '') : '';
      }
      if (path.startsWith('modal.')) return String(vars.modalValues?.[path.slice(6)] ?? '');
      if (path.startsWith('value.')) return String(vars.values[path.slice(6)] ?? '');
      if (path.startsWith('event.')) return String(this.pick(vars.event ?? {}, path.slice(6)) ?? '');
      return '';
    });
  }

  private pick(source: Record<string, unknown>, dotted: string): unknown {
    return dotted.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), source);
  }

  // ── Conditions (Specification) ───────────────────────────────────

  async evaluate(spec: unknown, vars: PipelineVars): Promise<boolean> {
    const parsed = ConditionSpecSchema.safeParse(spec);
    if (!parsed.success) return false;
    return this.evalSpec(parsed.data, vars);
  }

  private async evalSpec(spec: ConditionSpec, vars: PipelineVars): Promise<boolean> {
    switch (spec.kind) {
      case 'state': {
        // Sources dans l'ordre : state.<path>/event.<path> explicites, puis
        // FALLBACK état de la surface par chemin nu (« claimedBy »), enfin
        // interpolation générale ({{...}}).
        let actual: unknown;
        if (spec.path.startsWith('state.')) {
          actual = this.pick(vars.state, spec.path.slice(6));
        } else if (spec.path.startsWith('event.')) {
          actual = this.pick(vars.event ?? {}, spec.path.slice(6));
        } else if (this.pick(vars.state, spec.path) !== undefined) {
          actual = this.pick(vars.state, spec.path);
        } else {
          actual = this.coerce(this.interpolate(spec.path, vars));
        }
        switch (spec.op) {
          case 'exists': return actual !== undefined && actual !== null;
          case 'eq': return actual === spec.value;
          case 'ne': return actual !== spec.value;
          case 'contains': return String(actual ?? '').includes(String(spec.value ?? ''));
          case 'gt': return Number(actual) > Number(spec.value);
          case 'gte': return Number(actual) >= Number(spec.value);
          case 'lt': return Number(actual) < Number(spec.value);
          case 'lte': return Number(actual) <= Number(spec.value);
          default: return false;
        }
      }
      case 'records.count': {
        const rows = await this.prisma.agentRecord.findMany({
          where: {
            guildId: vars.guildId,
            collection: spec.collection,
            ...(spec.filterDataContains ? { data: { contains: spec.filterDataContains } } : {}),
            ...(spec.createdBy ? { createdBy: spec.createdBy } : {}),
          },
          select: { id: true },
        });
        const count = rows.length;
        return spec.op === 'gte' ? count >= spec.value : spec.op === 'lte' ? count <= spec.value : count === spec.value;
      }
      case 'voice.inChannel': {
        const userId = this.interpolate(spec.userId, vars);
        const guild = this.client.guilds.cache.get(vars.guildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        if (!member?.voice.channelId) return false;
        return spec.channelId ? member.voice.channelId === this.interpolate(spec.channelId, vars) : true;
      }
      case 'member.hasRole': {
        const userId = this.interpolate(spec.userId, vars);
        const guild = this.client.guilds.cache.get(vars.guildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        return member?.roles.cache.has(spec.roleId) ?? false;
      }
      case 'member.accountAgeDays': {
        const userId = this.interpolate(spec.userId, vars);
        const user = await this.client.users.fetch(userId).catch(() => null);
        if (!user) return false;
        const days = Math.floor((Date.now() - user.createdTimestamp) / 86_400_000);
        return spec.op === 'gte' ? days >= spec.value : days <= spec.value;
      }
      case 'member.joinedDays': {
        const userId = this.interpolate(spec.userId, vars);
        const guild = this.client.guilds.cache.get(vars.guildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        if (!member?.joinedTimestamp) return false;
        const days = Math.floor((Date.now() - member.joinedTimestamp) / 86_400_000);
        return spec.op === 'gte' ? days >= spec.value : days <= spec.value;
      }
      case 'regex': {
        try {
          return new RegExp(spec.pattern, 'iu').test(this.interpolate(spec.input, vars));
        } catch {
          return false;
        }
      }
      case 'slidingWindow': {
        const key = this.interpolate(spec.key, vars);
        const count = await this.cache.active.windowIncr(`cond:${vars.guildId}:${key}`, spec.windowSec);
        return count >= spec.threshold;
      }
      case 'all': {
        for (const child of spec.conditions) {
          if (!(await this.evalSpec(child, vars))) return false;
        }
        return true;
      }
      case 'any': {
        for (const child of spec.conditions) {
          if (await this.evalSpec(child, vars)) return true;
        }
        return false;
      }
      case 'not':
        return !(await this.evalSpec(spec.condition, vars));
      default:
        return false;
    }
  }

  private coerce(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^-?\d+(\.\d+)?$/u.test(value)) return Number(value);
    return value;
  }

  // ── AccessPolicy ─────────────────────────────────────────────────

  async checkAccess(binding: InteractionBinding, ctx: PipelineContext): Promise<{ allowed: boolean; deny?: string }> {
    const access = binding.access ?? {};
    const { vars, member } = ctx;
    if (access.userIds && !access.userIds.includes(vars.actorId)) {
      return { allowed: false, deny: access.denyMessage ?? 'Réservé à certains membres.' };
    }
    if (access.roleIds && access.roleIds.length > 0) {
      const has = member?.roles.cache.hasAny(...access.roleIds) ?? false;
      if (!has) return { allowed: false, deny: access.denyMessage ?? 'Rôle requis pour cette action.' };
    }
    if (access.permissions && access.permissions.length > 0) {
      const hasAll = (member?.permissions.toArray() as string[] | undefined)?.includes('Administrator') === true
        || access.permissions.every((permission) => (member?.permissions.toArray() as string[] | undefined)?.includes(permission));
      if (!hasAll) return { allowed: false, deny: access.denyMessage ?? `Permissions requises : ${access.permissions.join(', ')}.` };
    }
    if (access.condition && !(await this.evaluate(access.condition, vars))) {
      return { allowed: false, deny: access.denyMessage ?? 'Condition non remplie pour le moment.' };
    }
    if (access.cooldownPerUserSec) {
      const key = `cd:${vars.surfaceId}:${binding.key}:${vars.actorId}`;
      const already = await this.cache.active.get(key);
      if (already) {
        return { allowed: false, deny: access.denyMessage ?? 'Tu vas trop vite : réessaie dans un instant.' };
      }
      await this.cache.active.set(key, new Date().toISOString(), access.cooldownPerUserSec);
    }
    return { allowed: true };
  }

  // ── Exécution du pipeline ────────────────────────────────────────

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
            const interpolatedInput = this.deepInterpolate(step.input, ctx.vars);
            const toolResult = await ctx.runTool(step.name, interpolatedInput);
            stepResult.ok = toolResult.ok;
            stepResult.summary = toolResult.summary.slice(0, 300);
            Object.assign(stepResult, toolResult.data ?? {});
            if (!toolResult.ok) result.error ??= toolResult.summary.slice(0, 160);
            break;
          }
          case 'setState': {
            this.setPath(ctx.vars.state, step.path, step.value, step.mode);
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
            const targetChannel = step.channelId ? this.interpolate(step.channelId, ctx.vars) : ctx.vars.channelId;
            const channel = await this.client.channels.fetch(targetChannel).catch(() => null);
            const content = this.interpolate(step.content, ctx.vars).slice(0, 1900);
            const sent = channel?.isTextBased() && 'send' in channel
              ? await channel.send({ content }).then(() => true).catch(() => false)
              : false;
            stepResult.sent = sent;
            break;
          }
          case 'replyEphemeral': {
            result.replyEphemeral = this.interpolate(step.content, ctx.vars).slice(0, 1000);
            stepResult.ephemeral = true;
            break;
          }
          case 'openModal': {
            result.openModal = step.modal;
            stepResult.modal = step.modal.title;
            break;
          }
          case 'record.write': {
            const data = this.deepInterpolate(step.data, ctx.vars) as Record<string, unknown>;
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
                cancelKey: step.key ? this.interpolate(step.key, ctx.vars) : null,
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
              where: { guildId: ctx.vars.guildId, cancelKey: this.interpolate(step.key, ctx.vars), status: 'armed' },
              data: { status: 'cancelled' },
            });
            stepResult.cancelled = cancelled.count;
            break;
          }
          case 'random': {
            // crypto randomInt : les tirages alimentent des jeux/giveaways
            // à valeur réelle — jamais Math.random (prédictible).
            const min = Math.min(step.min, step.max);
            const max = Math.max(step.min, step.max);
            const value = randomInt(min, max + 1);
            stepResult.value = value;
            break;
          }
          case 'llm': {
            const prompt = this.interpolate(step.prompt, ctx.vars);
            const completion = await getLlm()
              .chat([{ role: 'user', content: prompt }], [], { userId: ctx.vars.actorId, guildId: ctx.vars.guildId, cause: 'consolidation' })
              .catch(() => null);
            stepResult.text = (completion?.content ?? '').slice(0, step.maxChars);
            break;
          }
          case 'if': {
            const branch = await this.evaluate(step.condition, ctx.vars);
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
            const key = this.interpolate(step.key, ctx.vars);
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

  private deepInterpolate(value: unknown, vars: PipelineVars): unknown {
    if (typeof value === 'string') return this.interpolate(value, vars);
    if (Array.isArray(value)) return value.map((item) => this.deepInterpolate(item, vars));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = this.deepInterpolate(item, vars);
      return out;
    }
    return value;
  }

  private setPath(state: Record<string, unknown>, dotted: string, value: unknown, mode: 'set' | 'increment' | 'decrement' | 'toggle'): void {
    const keys = dotted.split('.');
    let cursor: Record<string, unknown> = state;
    for (const key of keys.slice(0, -1)) {
      if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
      cursor = cursor[key] as Record<string, unknown>;
    }
    const last = keys[keys.length - 1];
    const current = cursor[last];
    if (mode === 'increment') cursor[last] = Number(current ?? 0) + Number(value ?? 1);
    else if (mode === 'decrement') cursor[last] = Number(current ?? 0) - Number(value ?? 1);
    else if (mode === 'toggle') cursor[last] = !current;
    else cursor[last] = value ?? null;
  }

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
}

/** Schéma utilitaire exporté pour les consumers (validation runtime). */
export const SurfaceDefinitionCheck = z.custom<SurfaceDefinition>();
