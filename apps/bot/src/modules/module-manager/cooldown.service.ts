import { Injectable } from '@spraxium/common';
import { type ModuleConstraints } from '@10cordes/shared';
import { CooldownException, RateLimitException } from '@spraxium/core';

/**
 * Cooldowns par utilisateur + quotas par rôle (mod quotas), par module et par serveur.
 * En mémoire (reset au restart) — le garde-fou est en amont du handler.
 */
@Injectable()
export class CooldownService {
  private readonly userHits = new Map<string, number[]>();
  private readonly roleHits = new Map<string, number[]>();

  check(
    guildId: string,
    userId: string,
    memberRoleIds: string[],
    moduleId: string,
    constraints: ModuleConstraints,
  ): void {
    const now = Date.now();

    if (constraints.cooldownMs !== null && constraints.cooldownMs > 0) {
      const key = `${guildId}:${moduleId}:${userId}`;
      const hits = this.prune(this.userHits.get(key) ?? [], now - constraints.cooldownMs);
      if (hits.length > 0) {
        const remainingMs = constraints.cooldownMs - (now - hits[hits.length - 1]);
        throw new CooldownException({ seconds: Math.max(1, Math.ceil(remainingMs / 1_000)) });
      }
      hits.push(now);
      this.userHits.set(key, hits);
    }

    for (const quota of constraints.roleQuotas) {
      if (!memberRoleIds.includes(quota.roleId)) continue;
      const key = `${guildId}:${moduleId}:${quota.roleId}`;
      const hits = this.prune(this.roleHits.get(key) ?? [], now - quota.windowMs);
      if (hits.length >= quota.maxActions) {
        const retryAfter = Math.max(1, Math.ceil((hits[0] + quota.windowMs - now) / 1_000));
        throw new RateLimitException({ retryAfter, route: moduleId });
      }
      hits.push(now);
      this.roleHits.set(key, hits);
    }
  }

  private prune(hits: number[], since: number): number[] {
    return hits.filter((hit) => hit > since);
  }
}
