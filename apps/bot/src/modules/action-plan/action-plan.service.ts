import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client, type ButtonInteraction, type Guild, type GuildMember, type MessageCreateOptions } from 'discord.js';
import type { ToolRunContext } from '@10cordes/shared';
import { interactionAccessContext } from '../../core/security/access-policy';
import { actionPlanPolicy, type PlanAction } from '../../core/security/action-plan.policy';
import { roleIdsOf } from '../../core/security/permission-name';
import { AuditService } from '../audit/audit.service';
import { archiveServerSnapshot, requiresServerSnapshot } from '../assistant/agent-history';
import { PrismaService } from '../database/prisma.service';
import { SurfaceNoticePresenter } from '../surface/presenters/surface-notice.presenter';
import { InteractionReply } from '../surface/surface-reply';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { ActionPlanPresenter } from './action-plan.presenter';
import { bindActionPlans } from './action-plan.runtime';
import { reviewPlanActions } from './action-plan.review';
import { PlanSummaryWriter } from './action-plan.summary';
import { PlanStaging } from './action-plan.staging';
import { ActionPlanStore } from './action-plan.store';
import { PLAN_LIMITS, type ActionPlan, type PlanRequest } from './action-plan.types';

/**
 * Plans d'action (transposé de discord-agent) : les actions qui modifient,
 * rassemblées derrière UNE approbation, et c'est le clic qui les exécute.
 * Le modèle n'exécute jamais lui-même une action approuvée : il propose, la
 * Policy revalide, le bot applique.
 *
 *   tool qui modifie bloqué par la règle → `stage` (en attente, en mémoire)
 *   fin de la demande                      → `flush` (revue, résumé, un plan, un panneau)
 *   clic « Appliquer »                     → `apply`  (prise du plan, revalidation, exécution)
 *   clic « Annuler »                       → `cancel`
 */

/** Ce qu'un échec imprévu doit dire à l'utilisateur. */
const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 200);

@Injectable()
export class ActionPlanService implements SpraxiumOnBoot {
  private readonly log = new Logger('ActionPlan');
  private readonly presenter = new ActionPlanPresenter();
  private readonly store: ActionPlanStore;
  private readonly staging = new PlanStaging();
  private readonly summaries = new PlanSummaryWriter();

  constructor(
    prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly client: Client,
    private readonly registry: ToolRegistryService,
  ) {
    this.store = new ActionPlanStore(prisma);
  }

  onBoot(): void {
    bindActionPlans(this);
    this.log.info('ActionPlan ready (plan:apply / plan:cancel).');
  }

  /**
   * Le registry bloque une action qui modifie : elle rejoint le plan de la
   * demande en cours. Null quand aucun plan ne peut être affiché (pas de
   * salon : la porte du registry refuse alors sans promettre de panneau).
   */
  stage(ctx: ToolRunContext, tool: string, input: Record<string, unknown>): { count: number; full: boolean } | null {
    return this.staging.stage(ctx, tool, input);
  }

  /**
   * Fin de la demande : les actions en attente de ce demandeur forment UN
   * plan, affiché une seule fois. Chaque action est revue AVANT l'affichage
   * (une action que le demandeur ne peut pas exécuter est écartée, et dite
   * telle), puis le modèle en écrit le résumé. Null sans action en attente,
   * ou quand aucune ne survit à la revue.
   */
  async flush(guildId: string, userId: string, request: PlanRequest = {}): Promise<ActionPlan | null> {
    const gathered = this.staging.take(guildId, userId);
    if (!gathered) return null;
    const { channelId } = gathered;
    const guild = this.client.guilds.cache.get(guildId) ?? null;
    const member = guild ? await guild.members.fetch({ user: userId, force: true }).catch(() => null) : null;
    const { kept, dropped } = reviewPlanActions(member, gathered.actions.slice(0, PLAN_LIMITS.maxActions), (name) => this.registry.get(name));

    if (kept.length === 0) {
      this.audit.record({ guildId, source: 'agent', action: 'plan.rejected', actorId: userId, metadata: { dropped: dropped.map((entry) => `${entry.tool} : ${entry.reason}`) } });
      await this.post(channelId, this.presenter.rejected(dropped));
      return null;
    }

    await this.store.purgeExpired(guildId, Date.now()).catch(() => 0);
    const now = Date.now();
    const id = await this.store.create({
      guildId,
      channelId,
      requesterId: userId,
      messageId: null,
      actions: kept,
      summary: null,
      dropped,
      status: 'pending',
      createdAt: now,
      expiresAt: now + PLAN_LIMITS.lifetimeMs,
      report: null,
    });
    const plan = await this.store.get(id);
    if (!plan) return null;
    plan.summary = await this.summaries.write({ guildId, userId, request, actions: plan.actions });
    plan.messageId = await this.post(channelId, this.presenter.render(plan));
    if (!plan.messageId) {
      plan.status = 'cancelled';
      plan.report = { done: 0, reason: 'panneau non affiché' };
    }
    await this.store.save(plan);
    this.audit.record({
      guildId,
      source: 'agent',
      action: 'plan.posted',
      actorId: userId,
      metadata: { planId: id, actions: plan.actions.length, dropped: plan.dropped.length, summary: plan.summary !== null, posted: Boolean(plan.messageId) },
    });
    return plan;
  }

  /** Clic « Appliquer » : le plan est pris une seule fois, chaque action revérifiée puis exécutée dans l'ordre. */
  async apply(planId: string, interaction: ButtonInteraction): Promise<void> {
    const reply = new InteractionReply(interaction, new SurfaceNoticePresenter());
    const plan = await this.store.get(planId).catch(() => null);
    if (!plan || !interaction.guild || plan.guildId !== interaction.guild.id) return reply.show(this.presenter.denied('Ce plan est introuvable sur ce serveur.'));
    if (!actionPlanPolicy.isRequester(plan, interaction.user.id)) return reply.show(this.presenter.denied('Seul l\u0027auteur de la demande peut appliquer ce plan.'));
    if (!(await this.store.lock(plan.id))) return reply.show(this.presenter.denied('Ce plan a déjà été appliqué, annulé ou a expiré.'));

    await reply.defer();
    // Contrôles qui annulent sans rien exécuter, AVANT de passer le plan « en cours ».
    const halted = this.preflight(plan, interaction);
    if (halted) {
      await this.close(plan);
      return reply.show(this.presenter.receipt(plan));
    }
    plan.status = 'executing';
    plan.report = { done: 0 };
    try {
      await this.runActions(plan, interaction.guild, interaction);
      await this.close(plan);
    } catch (error) {
      // Échec imprévu : le plan se referme comme les autres interruptions (panneau, audit).
      this.abort(plan, 'interrupted', reasonOf(error));
      await this.close(plan).catch(() => null);
    }
    await reply.show(this.presenter.receipt(plan));
  }

  /**
   * Message d'approbation modifié hors du service, ou délai dépassé : le plan
   * s'arrête là. Vrai quand il s'est arrêté (le plan porte alors son statut).
   */
  private preflight(plan: ActionPlan, interaction: ButtonInteraction): boolean {
    if (interaction.message?.editedTimestamp) {
      plan.status = 'cancelled';
      plan.report = { done: 0, reason: 'message d\u0027approbation modifié' };
      return true;
    }
    if (actionPlanPolicy.isExpired(plan)) {
      plan.status = 'expired';
      plan.report = { done: 0, reason: 'délai d\u0027approbation dépassé' };
      return true;
    }
    return false;
  }

  /** Clic « Annuler » : rien n'est exécuté, le plan ne peut plus l'être. */
  async cancel(planId: string, interaction: ButtonInteraction): Promise<void> {
    const reply = new InteractionReply(interaction, new SurfaceNoticePresenter());
    const plan = await this.store.get(planId).catch(() => null);
    if (!plan || !interaction.guild || plan.guildId !== interaction.guild.id) return reply.show(this.presenter.denied('Ce plan est introuvable sur ce serveur.'));
    if (!actionPlanPolicy.isRequester(plan, interaction.user.id)) return reply.show(this.presenter.denied('Seul l\u0027auteur de la demande peut annuler ce plan.'));
    if (!(await this.store.lock(plan.id))) return reply.show(this.presenter.denied('Ce plan a déjà été appliqué, annulé ou a expiré.'));
    // Un plan dont le délai est passé, et pas encore purgé, se referme comme expiré.
    const expired = actionPlanPolicy.isExpired(plan);
    plan.status = expired ? 'expired' : 'cancelled';
    plan.report = { done: 0, ...(expired ? { reason: 'délai d\u0027approbation dépassé' } : {}) };
    await reply.defer();
    await this.close(plan);
    await reply.show(this.presenter.receipt(plan));
  }

  /** Le cœur : revalidation déterministe de chaque action, puis exécution. Le plan est modifié en place. */
  private async runActions(plan: ActionPlan, guild: Guild, interaction: ButtonInteraction): Promise<void> {
    const member = await guild.members.fetch({ user: plan.requesterId, force: true }).catch(() => null);
    if (!member) return this.abort(plan, 'interrupted', 'membre introuvable sur ce serveur');

    if (plan.actions.some((action) => requiresServerSnapshot(action.tool))) archiveServerSnapshot(this.audit, guild, plan.requesterId, `plan:${plan.id}`);
    const context = this.contextOf(plan, member, interaction);
    for (const action of plan.actions) {
      const review = actionPlanPolicy.review(member, action, this.registry.get(action.tool));
      if (!review.ok) return this.stop(plan, action, review.reason);
      const result = await this.registry.run(action.tool, action.input, context, { approvedBy: plan.id });
      this.audit.record({
        guildId: plan.guildId,
        source: 'agent',
        action: 'plan.action',
        actorId: plan.requesterId,
        metadata: { planId: plan.id, tool: action.tool, ok: result.ok, summary: result.summary.slice(0, 200) },
      });
      if (!result.ok) return this.stop(plan, action, result.summary);
      plan.report = { done: (plan.report?.done ?? 0) + 1 };
    }
    plan.status = 'executed';
  }

  private abort(plan: ActionPlan, status: ActionPlan['status'], reason: string): void {
    plan.status = status;
    plan.report = { done: plan.report?.done ?? 0, reason };
  }

  private stop(plan: ActionPlan, action: PlanAction, reason: string): void {
    plan.status = 'interrupted';
    plan.report = { done: plan.report?.done ?? 0, stoppedAt: action.tool, reason };
  }

  /** Termine le plan : état persisté, panneau remplacé par son résultat, trace d'audit. */
  private async close(plan: ActionPlan): Promise<void> {
    await this.store.save(plan).catch(() => null);
    await this.paint(plan, this.presenter.renderOutcome(plan), true);
    this.audit.record({
      guildId: plan.guildId,
      source: 'agent',
      action: `plan.${plan.status}`,
      actorId: plan.requesterId,
      metadata: { planId: plan.id, done: plan.report?.done ?? 0, total: plan.actions.length, stoppedAt: plan.report?.stoppedAt, reason: plan.report?.reason },
    });
  }

  /**
   * Contexte d'exécution d'un tool du plan : le demandeur tel qu'il est AU
   * CLIC (permissions portées par l'interaction, rôles du membre rechargé).
   * Le plan est approuvé : cette autorisation vaut pour chaque action et
   * pour ce qu'elle déclenche.
   */
  private contextOf(plan: ActionPlan, member: GuildMember, interaction: ButtonInteraction): ToolRunContext {
    return {
      guildId: plan.guildId,
      channelId: plan.channelId,
      userId: plan.requesterId,
      locale: interaction.locale,
      permissions: interactionAccessContext(interaction)?.permissions ?? [],
      roleIds: roleIdsOf(member),
      approvedBy: plan.id,
      reply: async () => undefined,
    };
  }

  /** Affiche (ou remplace) le panneau d'un plan ; null si le salon n'est plus accessible, ou si le panneau à remplacer n'est pas connu. */
  private async paint(plan: ActionPlan, payload: MessageCreateOptions, edit = false): Promise<string | null> {
    if (!edit) return this.post(plan.channelId, payload, plan.id);
    try {
      if (!plan.messageId) return null;
      const channel = this.client.channels.cache.get(plan.channelId) ?? (await this.client.channels.fetch(plan.channelId).catch(() => null));
      if (!channel?.isTextBased() || !('send' in channel)) return null;
      const message = await channel.messages.fetch(plan.messageId).catch(() => null);
      await message?.edit({ components: payload.components, allowedMentions: { parse: [] } });
      return plan.messageId;
    } catch (error) {
      this.log.warn(`panneau du plan ${plan.id} impossible (${reasonOf(error).slice(0, 120)})`);
      return null;
    }
  }

  /** Envoie un panneau dans un salon, sans notifier personne ; null si le salon n'est plus accessible. */
  private async post(channelId: string, payload: MessageCreateOptions, planId = ''): Promise<string | null> {
    try {
      const channel = this.client.channels.cache.get(channelId) ?? (await this.client.channels.fetch(channelId).catch(() => null));
      if (!channel?.isTextBased() || !('send' in channel)) return null;
      return (await channel.send({ ...payload, allowedMentions: { parse: [] } })).id;
    } catch (error) {
      this.log.warn(`panneau du plan ${planId} impossible (${reasonOf(error).slice(0, 120)})`);
      return null;
    }
  }
}
