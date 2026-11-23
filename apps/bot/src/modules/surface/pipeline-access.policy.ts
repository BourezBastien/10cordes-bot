import type { InteractionBinding } from '@10cordes/shared';
import type { CacheStoreService } from '../../shared/cache/cache-store.service';
import { memberPermissionPolicy } from '../../core/security/member-permission.policy';
import type { ConditionEvaluator } from './pipeline-condition.evaluator';
import type { PipelineContext } from './pipeline.types';

export interface BindingAccessPolicyDeps {
  readonly cache: CacheStoreService;
  readonly evaluator: ConditionEvaluator;
}

/**
 * Policy d'accès d'un binding de surface (bouton ou option de menu) :
 * membres autorisés, rôles requis, permissions Discord requises, condition
 * dynamique puis cooldown par utilisateur. Évaluée AVANT toute exécution ;
 * le premier critère non rempli refuse. Les permissions et rôles du membre
 * sont lus par MemberPermissionPolicy (couche Sécurité).
 */
export class BindingAccessPolicy {
  readonly policyName = 'BindingAccess';

  constructor(private readonly deps: BindingAccessPolicyDeps) {}

  async checkAccess(binding: InteractionBinding, ctx: PipelineContext): Promise<{ allowed: boolean; deny?: string }> {
    const access = binding.access ?? {};
    const { vars, member } = ctx;
    if (access.userIds && !access.userIds.includes(vars.actorId)) {
      return { allowed: false, deny: access.denyMessage ?? 'Réservé à certains membres.' };
    }
    if (access.roleIds && access.roleIds.length > 0 && !memberPermissionPolicy.hasAnyRole(member, access.roleIds)) {
      return { allowed: false, deny: access.denyMessage ?? 'Rôle requis pour cette action.' };
    }
    if (access.permissions && access.permissions.length > 0 && !memberPermissionPolicy.hasAllNames(member, access.permissions)) {
      return { allowed: false, deny: access.denyMessage ?? `Permissions requises : ${access.permissions.join(', ')}.` };
    }
    if (access.condition && !(await this.deps.evaluator.evaluate(access.condition, vars))) {
      return { allowed: false, deny: access.denyMessage ?? 'Condition non remplie pour le moment.' };
    }
    if (access.cooldownPerUserSec) {
      const key = `cd:${vars.surfaceId}:${binding.key}:${vars.actorId}`;
      const already = await this.deps.cache.active.get(key);
      if (already) {
        return { allowed: false, deny: access.denyMessage ?? 'Tu vas trop vite : réessaie dans un instant.' };
      }
      await this.deps.cache.active.set(key, new Date().toISOString(), access.cooldownPerUserSec);
    }
    return { allowed: true };
  }
}
