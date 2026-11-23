import type { Client } from 'discord.js';
import { ConditionSpecSchema, type ConditionSpec } from '@10cordes/shared';
import type { PrismaService } from '../database/prisma.service';
import type { CacheStoreService } from '../../shared/cache/cache-store.service';
import { memberPermissionPolicy } from '../../core/security/member-permission.policy';
import type { PipelineInterpolator } from './pipeline-interpolation';
import type { PipelineVars } from './pipeline.types';

export interface ConditionEvaluatorDeps {
  readonly prisma: PrismaService;
  readonly client: Client;
  readonly cache: CacheStoreService;
  readonly interpolator: PipelineInterpolator;
}

const DAY_MS = 86_400_000;

/**
 * Évaluateur de ConditionSpec (pattern Specification) : la condition d'un
 * accès, d'un trigger planifié ou d'une étape `if`. Une spec invalide ou un
 * échec de lecture vaut toujours FAUX (refus par défaut).
 */
export class ConditionEvaluator {
  constructor(private readonly deps: ConditionEvaluatorDeps) {}

  /** Évalue une spec brute (invalide = faux). */
  async evaluate(spec: unknown, vars: PipelineVars): Promise<boolean> {
    const parsed = ConditionSpecSchema.safeParse(spec);
    if (!parsed.success) return false;
    return this.evalSpec(parsed.data, vars);
  }

  /** Membre résolu depuis le cache du serveur (null si absent ou introuvable). */
  private async memberOf(userId: string, guildId: string) {
    const guild = this.deps.client.guilds.cache.get(guildId);
    return guild ? await guild.members.fetch(userId).catch(() => null) : null;
  }

  private async evalSpec(spec: ConditionSpec, vars: PipelineVars): Promise<boolean> {
    const { prisma, client, cache, interpolator } = this.deps;
    switch (spec.kind) {
      case 'state': {
        // Sources dans l'ordre : state.<path>/event.<path> explicites, puis
        // FALLBACK état de la surface par chemin nu (« claimedBy »), enfin
        // interpolation générale ({{...}}).
        let actual: unknown;
        if (spec.path.startsWith('state.')) {
          actual = interpolator.readPath(vars.state, spec.path.slice(6));
        } else if (spec.path.startsWith('event.')) {
          actual = interpolator.readPath(vars.event ?? {}, spec.path.slice(6));
        } else if (interpolator.readPath(vars.state, spec.path) !== undefined) {
          actual = interpolator.readPath(vars.state, spec.path);
        } else {
          actual = interpolator.coerce(interpolator.interpolate(spec.path, vars));
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
        const rows = await prisma.agentRecord.findMany({
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
        const member = await this.memberOf(interpolator.interpolate(spec.userId, vars), vars.guildId);
        if (!member?.voice.channelId) return false;
        return spec.channelId ? member.voice.channelId === interpolator.interpolate(spec.channelId, vars) : true;
      }
      case 'member.hasRole': {
        const member = await this.memberOf(interpolator.interpolate(spec.userId, vars), vars.guildId);
        return memberPermissionPolicy.hasRole(member, spec.roleId);
      }
      case 'member.accountAgeDays': {
        const user = await client.users.fetch(interpolator.interpolate(spec.userId, vars)).catch(() => null);
        if (!user) return false;
        const days = Math.floor((Date.now() - user.createdTimestamp) / DAY_MS);
        return spec.op === 'gte' ? days >= spec.value : days <= spec.value;
      }
      case 'member.joinedDays': {
        const member = await this.memberOf(interpolator.interpolate(spec.userId, vars), vars.guildId);
        if (!member?.joinedTimestamp) return false;
        const days = Math.floor((Date.now() - member.joinedTimestamp) / DAY_MS);
        return spec.op === 'gte' ? days >= spec.value : days <= spec.value;
      }
      case 'regex': {
        try {
          return new RegExp(spec.pattern, 'iu').test(interpolator.interpolate(spec.input, vars));
        } catch {
          return false;
        }
      }
      case 'slidingWindow': {
        const key = interpolator.interpolate(spec.key, vars);
        const count = await cache.active.windowIncr(`cond:${vars.guildId}:${key}`, spec.windowSec);
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
}
