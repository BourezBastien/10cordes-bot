import type { GuildMember } from 'discord.js';
import type { BotTool } from '@10cordes/shared';
import { memberPermissionPolicy } from './member-permission.policy';
import { isPermissionName } from './permission-name';

/**
 * Policy d'un plan d'action : ce qu'un membre a le droit de faire exécuter
 * par le bot, revérifié À L'INSTANT DU CLIC sur un membre rechargé. La
 * validation faite quand le modèle a proposé l'action ne suffit pas : entre
 * les deux, un rôle a pu être retiré, une cible promue, un salon fermé.
 *
 * Règles, toutes déterministes (jamais laissées au modèle) :
 * - seul l'auteur du plan peut l'appliquer ou l'annuler ;
 * - un plan s'applique une fois, en attente, avant expiration ;
 * - tout identifiant Discord d'une action est un snowflake ;
 * - l'auteur détient les permissions de l'outil, dans le serveur ET dans le
 *   salon visé quand il y en a un ;
 * - la hiérarchie est respectée : cible membre strictement au-dessous (sauf
 *   pour se donner un rôle), rôle strictement au-dessous et non géré.
 */

export interface PlanAction {
  tool: string;
  input: Record<string, unknown>;
}

export type PlanReview = { ok: true } | { ok: false; reason: string };

const SNOWFLAKE_RE = /^\d{1,20}$/u;
const MEMBER_TARGET_KEYS: readonly string[] = ['memberId', 'userId', 'targetId'];
const ROLE_TARGET_KEYS: readonly string[] = ['roleId'];
/** Sanctions : jamais sur soi-même ; un bannissement peut viser un membre parti. */
const MODERATION_PERMISSIONS: readonly string[] = ['BanMembers', 'KickMembers', 'ModerateMembers', 'ManageNicknames'];

export class ActionPlanPolicy {
  readonly policyName = 'ActionPlan';

  /** L'auteur du plan, et lui seul, peut l'appliquer ou l'annuler. */
  isRequester(plan: { requesterId: string }, userId: string): boolean {
    return plan.requesterId === userId;
  }

  /** Le délai d'approbation est-il dépassé ? */
  isExpired(plan: { expiresAt: number }, now = Date.now()): boolean {
    return plan.expiresAt <= now;
  }

  /** Tout identifiant Discord passé à une action (clé terminée par `Id`) est un snowflake. */
  hasValidIds(input: Record<string, unknown>): boolean {
    return Object.entries(input).every(([key, value]) => !key.endsWith('Id') || typeof value !== 'string' || SNOWFLAKE_RE.test(value));
  }

  /**
   * L'auteur peut-il exécuter cette action maintenant ? `actor` est le membre
   * rechargé au clic ; sans membre, rien n'est permis.
   */
  review(actor: GuildMember | null, action: PlanAction, tool: BotTool | undefined): PlanReview {
    if (!actor) return { ok: false, reason: 'membre introuvable sur ce serveur' };
    if (!tool) return { ok: false, reason: `outil « ${action.tool} » inconnu` };
    if (actor.isCommunicationDisabled()) return { ok: false, reason: 'compte suspendu temporairement' };
    if (!this.hasValidIds(action.input)) return { ok: false, reason: 'identifiant Discord mal formé' };

    const required: readonly string[] = tool.permissions ?? [];
    if (!memberPermissionPolicy.hasAllNames(actor, required)) {
      return { ok: false, reason: `permission requise : ${required.join(' + ') || 'aucune'}` };
    }
    const scoped = this.reviewChannel(actor, action, required);
    if (!scoped.ok) return scoped;
    return this.reviewHierarchy(actor, action, required);
  }

  /** Le salon visé existe, et l'auteur y détient chaque permission de l'outil (overwrites compris). Un nom inconnu compte pour manquant. */
  private reviewChannel(actor: GuildMember, action: PlanAction, required: readonly string[]): PlanReview {
    const target = action.input.channelId;
    if (target === undefined || target === null) return { ok: true };
    const channel = actor.guild.channels.cache.get(String(target));
    if (!channel) return { ok: false, reason: 'salon introuvable' };
    const missing = required.filter((permission) => !isPermissionName(permission) || !memberPermissionPolicy.hasIn(actor, channel, permission));
    return missing.length > 0 ? { ok: false, reason: `permission manquante dans ce salon : ${missing.join(' + ')}` } : { ok: true };
  }

  /** Cible membre et rôle visé placés sous l'auteur. */
  private reviewHierarchy(actor: GuildMember, action: PlanAction, required: readonly string[]): PlanReview {
    const moderation = required.some((permission) => MODERATION_PERMISSIONS.includes(permission));
    for (const key of MEMBER_TARGET_KEYS) {
      const targetId = action.input[key];
      if (typeof targetId !== 'string') continue;
      const allowed = memberPermissionPolicy.canActOn(actor, actor.guild.members.cache.get(targetId) ?? null, {
        allowAbsent: required.includes('BanMembers'),
        allowSelf: !moderation,
      });
      if (!allowed) return { ok: false, reason: 'cible placée au-dessus de toi (ou toi-même)' };
    }
    for (const key of ROLE_TARGET_KEYS) {
      const roleId = action.input[key];
      if (typeof roleId !== 'string') continue;
      if (!memberPermissionPolicy.canManageRole(actor, actor.guild.roles.cache.get(roleId))) {
        return { ok: false, reason: 'rôle placé au-dessus de toi, ou géré par une intégration' };
      }
    }
    return { ok: true };
  }
}

/** Instance singleton (la policy est sans état). */
export const actionPlanPolicy = new ActionPlanPolicy();
