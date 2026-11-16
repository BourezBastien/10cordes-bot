import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { PermissionDeniedException, ValidationException } from '@spraxium/core';
import { PermissionFlagsBits, Client, type Guild, type GuildMember, type User } from 'discord.js';
import {
  analyzeDisableCascade,
  dependenciesToEnable,
  findModule,
  missingDependencies,
  AdminOpSchema,
  opLabel,
  DESTRUCTIVE_OP_TYPES,
  type AgentPlanInput,
  type AdminOp,
  type DisableCascade,
  type ModuleDescriptor,
} from '@10cordes/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { ModerationService } from '../moderation/moderation.service';
import { AdminWhitelistService } from './whitelist.service';
import { agentTools } from './tools/discord.tools';
import { findModuleByCommand, MODULE_CATALOG } from '../module-manager/module.catalog';
import { moduleStateStore } from '../module-manager/module-state.store';
import { CooldownService } from '../module-manager/cooldown.service';
import { GuildModuleStateService } from '../module-manager/guild-module-state.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { ModuleChannelException } from '../module-manager/module-channel.exception';
import { ModuleDependencyException } from '../module-manager/module-dependency.exception';
import { ModuleDisabledException } from '../module-manager/module-disabled.exception';

export type ModuleScope = 'guild' | 'global';

export interface CommandAccessContext {
  guildId: string | null;
  userId: string;
  channelId: string;
  memberRoleIds: string[];
  isAdministrator: boolean;
  commandName: string;
  /** Groupe de sous-commandes du /setup (résolution du module par catégorie). */
  commandGroup?: string;
}

export interface DisableResult {
  applied: boolean;
  cascade?: DisableCascade;
  disabled: string[];
}

export interface PlanOpResult {
  ok: boolean;
  label: string;
  detail?: string;
}

const PLAN_TTL_MS = 5 * 60 * 1_000;

let runtime: AgentService | undefined;

/** Accès runtime pour les contextes sans DI (guards, layouts). */
export function getModuleManager(): AgentService {
  if (!runtime) throw new Error('AgentService is not initialized yet.');
  return runtime;
}

/**
 * Agent Admin — plan → confirmation humaine → exécution → rapport → audit.
 * Fail-closed : expiration = annulation ; les ops destructives exigent la
 * whitelist (ou le owner) au moment du CLIC, pas seulement à la demande.
 */
@Injectable()
export class AgentService implements SpraxiumOnBoot {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly client: Client,
    private readonly whitelist: AdminWhitelistService,
    private readonly moderation: ModerationService,
    private readonly config: GuildConfigService,
    private readonly guildStates: GuildModuleStateService,
    private readonly cooldowns: CooldownService,
  ) {
    runtime = this;
  }

  /** Enregistre les tools discord.* dans le registry (boot, après le ToolRegistryModule). */
  async onBoot(): Promise<void> {
    const registry = getToolRegistry();
    for (const tool of agentTools(this, this.client)) {
      registry.register(tool);
    }
  }

  find(moduleId: string): ModuleDescriptor | undefined {
    return findModule(MODULE_CATALOG, moduleId);
  }

  /** Ensemble des modules actifs (global ∩ guild) — consommé par le ToolRegistry. */
  async activeModules(guildId: string | null): Promise<Set<string>> {
    return guildId ? this.guildActiveSet(guildId) : this.globalActiveSet();
  }

  /** État global + état du serveur fusionnés pour chaque module du catalogue. */
  async listModules(
    guildId: string | null,
  ): Promise<Array<ModuleDescriptor & { globalEnabled: boolean; guildEnabled: boolean | null }>> {
    return Promise.all(
      MODULE_CATALOG.map(async (module) => ({
        ...module,
        globalEnabled: moduleStateStore.isEnabled(module.id),
        guildEnabled: guildId ? await this.guildStates.isEnabled(guildId, module.id) : null,
      })),
    );
  }

  /** Active le module + toutes ses dépendances obligatoires inactives (ordre topologique). */
  async enableModule(scope: ModuleScope, guildId: string | null, moduleId: string): Promise<string[]> {
    const module = this.find(moduleId);
    if (!module) {
      throw new ValidationException({ field: 'module', reason: `Unknown module \`${moduleId}\`.` });
    }

    let active: Set<string>;
    let persist: (id: string) => Promise<void>;
    if (scope === 'global') {
      active = this.globalActiveSet();
      persist = (id) => Promise.resolve(moduleStateStore.setEnabled(id, true));
    } else {
      if (!guildId) throw new Error('Guild scope requires a guild context.');
      active = await this.guildActiveSet(guildId);
      const target = guildId;
      persist = (id) => this.guildStates.setEnabled(target, id, true);
    }

    const toEnable = [moduleId, ...dependenciesToEnable(MODULE_CATALOG, active, moduleId)];
    for (const id of toEnable) await persist(id);
    this.audit.record({
      guildId,
      source: 'discord',
      action: 'module.enable',
      targetId: moduleId,
      metadata: { scope, enabled: toEnable },
    });
    return toEnable;
  }

  /**
   * Désactive le module. Si des modules actifs en dépendent, renvoie la cascade
   * détaillée (à confirmer par l'utilisateur) sauf si `confirm` est déjà vrai.
   */
  async disableModule(
    scope: ModuleScope,
    guildId: string | null,
    moduleId: string,
    confirm: boolean,
  ): Promise<DisableResult> {
    if (!this.find(moduleId)) {
      throw new ValidationException({ field: 'module', reason: `Unknown module \`${moduleId}\`.` });
    }

    let active: Set<string>;
    let persist: (id: string) => Promise<void>;
    if (scope === 'global') {
      active = this.globalActiveSet();
      persist = (id) => Promise.resolve(moduleStateStore.setEnabled(id, false));
    } else {
      if (!guildId) throw new Error('Guild scope requires a guild context.');
      active = await this.guildActiveSet(guildId);
      const target = guildId;
      persist = (id) => this.guildStates.setEnabled(target, id, false);
    }

    if (!active.has(moduleId)) return { applied: false, disabled: [] };

    const cascade = analyzeDisableCascade(MODULE_CATALOG, active, moduleId);
    if (cascade.toDisable.length > 0 && !confirm) {
      return { applied: false, cascade, disabled: [] };
    }

    const all = [moduleId, ...cascade.toDisable];
    for (const id of all) await persist(id);
    this.audit.record({
      guildId,
      source: 'discord',
      action: 'module.disable',
      targetId: moduleId,
      metadata: { scope, disabled: all, confirmed: confirm },
    });
    return { applied: true, disabled: all };
  }

  /**
   * Pipeline d'accès complet d'une commande (appelé par le guard global) :
   * catalogue inconnu → pass ; global off → guild off → dépendances inactives
   * → whitelists → rôle requis → bypass admin → cooldown + quotas.
   */
  async assertCommandUsable(ctx: CommandAccessContext): Promise<void> {
    const module = findModuleByCommand(ctx.commandName);
    if (!module) return;

    if (!moduleStateStore.isEnabled(module.id)) throw new ModuleDisabledException(module.label);
    if (!ctx.guildId) return;

    if (!(await this.guildStates.isEnabled(ctx.guildId, module.id))) {
      throw new ModuleDisabledException(module.label);
    }

    const active = await this.guildActiveSet(ctx.guildId);
    const missing = missingDependencies(MODULE_CATALOG, active, module.id);
    if (missing.length > 0) {
      const labels = missing
        .map((id) => findModule(MODULE_CATALOG, id)?.label ?? id)
        .join(', ');
      throw new ModuleDependencyException(module.label, labels);
    }

    const constraints = await this.guildStates.getConstraints(ctx.guildId, module.id);
    if (constraints.exemptUsers.includes(ctx.userId)) return;
    if (constraints.channels.length > 0 && !constraints.channels.includes(ctx.channelId)) {
      throw new ModuleChannelException(module.label);
    }
    if (
      constraints.requiredRoles.length > 0 &&
      !constraints.requiredRoles.some((roleId) => ctx.memberRoleIds.includes(roleId))
    ) {
      throw new PermissionDeniedException({ permission: module.label });
    }

    if (constraints.adminBypass && ctx.isAdministrator) return;
    this.cooldowns.check(ctx.guildId, ctx.userId, ctx.memberRoleIds, module.id, constraints);
  }

  /** Crée un plan d'ops (validé par le schéma) en attente de confirmation humaine. */
  async createPlan(
    guildId: string,
    channelId: string,
    requesterId: string,
    input: AgentPlanInput,
  ): Promise<{ planId: string; expiresAt: Date; destructiveOps: AdminOp[] }> {
    const expiresAt = new Date(Date.now() + PLAN_TTL_MS);
    const plan = await this.prisma.agentPlan.create({
      data: {
        guildId,
        channelId,
        requesterId,
        title: input.title,
        ops: JSON.stringify(input.ops),
        expiresAt,
      },
    });
    this.audit.record({
      guildId,
      source: 'agent',
      action: 'agent.plan.created',
      actorId: requesterId,
      metadata: { planId: plan.id, title: input.title, ops: input.ops.length },
    });
    return {
      planId: plan.id,
      expiresAt,
      destructiveOps: input.ops.filter((op) => DESTRUCTIVE_OP_TYPES.has(op.type)),
    };
  }

  async latestPending(guildId: string, channelId: string): Promise<{ id: string } | null> {
    const plans = await this.listPending(guildId, channelId);
    return plans[0] ?? null;
  }

  /** Tous les plans en attente du salon (le plus ancien d'abord, avec titre). */
  async listPending(guildId: string, channelId: string): Promise<Array<{ id: string; title: string }>> {
    const plans = await this.prisma.agentPlan.findMany({
      where: { guildId, channelId, status: 'pending', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true },
    });
    return plans;
  }

  /**
   * Confirmation : le CLIQUEUR est autorisé ici (règle n°3) — whitelist/owner
   * pour les plans destructifs, ManageGuild sinon. Expiration = annulation.
   */
  async resolve(
    planId: string,
    approverId: string,
    action: 'approve' | 'cancel',
  ): Promise<{
    status: 'executed' | 'cancelled' | 'expired' | 'denied' | 'notfound';
    results?: PlanOpResult[];
    denialReason?: string;
    planTitle?: string;
  }> {
    const plan = await this.prisma.agentPlan.findUnique({ where: { id: planId } });
    if (!plan || plan.status !== 'pending') return { status: 'notfound', planTitle: plan?.title };
    if (plan.expiresAt.getTime() < Date.now()) {
      await this.prisma.agentPlan.update({ where: { id: planId }, data: { status: 'expired' } });
      return { status: 'expired', planTitle: plan.title };
    }

    const guild = this.client.guilds.cache.get(plan.guildId);
    if (!guild) return { status: 'notfound', planTitle: plan.title };

    if (action === 'cancel') {
      await this.prisma.agentPlan.update({
        where: { id: planId },
        data: { status: 'cancelled', approvedBy: approverId },
      });
      this.audit.record({
        guildId: plan.guildId,
        source: 'agent',
        action: 'agent.plan.cancelled',
        actorId: approverId,
        metadata: { planId, title: plan.title },
      });
      return { status: 'cancelled', planTitle: plan.title };
    }

    const ops = (JSON.parse(plan.ops) as AdminOp[]).map((op) => AdminOpSchema.parse(op));
    const hasDestructive = ops.some((op) => DESTRUCTIVE_OP_TYPES.has(op.type));

    // Gate d'approbation : owner/whitelist si destructif, ManageGuild sinon.
    const approverIsOwner = guild.ownerId === approverId;
    const approverWhitelisted = approverIsOwner || (await this.whitelist.isWhitelisted(plan.guildId, approverId));
    if (hasDestructive && !approverWhitelisted) {
      this.audit.record({
        guildId: plan.guildId,
        source: 'agent',
        action: 'agent.plan.denied',
        actorId: approverId,
        metadata: { planId, reason: 'not whitelisted' },
      });
      return {
        status: 'denied',
        denialReason: 'Ce plan contient des ops destructives : réservées au owner et à la whitelist.',
        planTitle: plan.title,
      };
    }
    const approverMember = await guild.members.fetch(approverId).catch(() => null);
    if (!hasDestructive && approverMember && !approverMember.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return { status: 'denied', denialReason: 'Permission ManageGuild requise pour approuver ce plan.', planTitle: plan.title };
    }

    const requesterMember = await guild.members.fetch(plan.requesterId).catch(() => null);
    const results: PlanOpResult[] = [];
    for (const op of ops) {
      const result = await this.executeOp(guild, op, plan.requesterId, requesterMember, approverId);
      results.push(result);
      this.audit.record({
        guildId: plan.guildId,
        source: 'agent',
        action: `agent.op.${op.type}`,
        actorId: approverId,
        metadata: { planId, requesterId: plan.requesterId, ok: result.ok, detail: result.detail ?? null },
      });
    }

    await this.prisma.agentPlan.update({
      where: { id: planId },
      data: { status: 'executed', approvedBy: approverId, results: JSON.stringify(results) },
    });
    return { status: 'executed', results, planTitle: plan.title };
  }

  /** Exécution d'une op — chaque op re-vérifie les permissions du bot en code. */
  private async executeOp(
    guild: Guild,
    op: AdminOp,
    requesterId: string,
    requesterMember: GuildMember | null,
    approverId: string,
  ): Promise<PlanOpResult> {
    const label = opLabel(op);
    const me = guild.members.me;
    const auditReason = `agent plan (requester <@${requesterId}>, approver <@${approverId}>)`;

    try {
      switch (op.type) {
        case 'channel.create': {
          if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission ManageChannels." };
          }
          const created = await guild.channels.create({
            name: op.name,
            type: op.kind === 'voice' ? 2 : op.kind === 'category' ? 4 : 0,
            topic: op.topic,
            reason: auditReason,
          });
          return { ok: true, label, detail: `créé → <#${created.id}>` };
        }
        case 'channel.rename': {
          if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission ManageChannels." };
          }
          const channel = await this.client.channels.fetch(op.channelId).catch(() => null);
          if (!channel || !('setName' in channel)) return { ok: false, label, detail: 'Salon introuvable.' };
          await channel.setName(op.name, auditReason);
          return { ok: true, label, detail: `renommé en **${op.name}**` };
        }
        case 'channel.archive': {
          if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission ManageChannels." };
          }
          const channel = await this.client.channels.fetch(op.channelId).catch(() => null);
          if (!channel || !('setName' in channel)) return { ok: false, label, detail: 'Salon introuvable.' };
          const snapshot = {
            name: channel.name,
            type: channel.type,
            topic: 'topic' in channel ? (channel.topic as string | null) : null,
          };
          await channel.setName(`archive-${channel.name}`, auditReason);
          return { ok: true, label, detail: `archivé (snapshot : \`${JSON.stringify(snapshot)}\`)` };
        }
        case 'channel.delete': {
          // Archive-first : snapshot → suppression (l'op destructif n'arrive ici
          // qu'après confirmation whitelist ; le snapshot est la trace restaurable).
          if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission ManageChannels." };
          }
          const channel = await this.client.channels.fetch(op.channelId).catch(() => null);
          if (!channel || !('delete' in channel)) return { ok: false, label, detail: 'Salon introuvable.' };
          const deletable = channel as import('discord.js').GuildChannel;
          const snapshot = {
            name: deletable.name,
            type: deletable.type,
          };
          await deletable.delete(auditReason);
          return { ok: true, label, detail: `supprimé (snapshot restaurable : \`${JSON.stringify(snapshot)}\`)` };
        }
        case 'role.create': {
          if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission ManageRoles." };
          }
          const role = await guild.roles.create({
            name: op.name,
            color: op.color,
            reason: auditReason,
          });
          return { ok: true, label, detail: `créé → <@&${role.id}>` };
        }
        case 'role.rename': {
          if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission ManageRoles." };
          }
          const role = await guild.roles.fetch(op.roleId).catch(() => null);
          if (!role) return { ok: false, label, detail: 'Rôle introuvable.' };
          await role.setName(op.name, auditReason);
          return { ok: true, label, detail: `renommé en **${op.name}**` };
        }
        case 'role.delete': {
          if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission ManageRoles." };
          }
          const role = await guild.roles.fetch(op.roleId).catch(() => null);
          if (!role) return { ok: false, label, detail: 'Rôle introuvable.' };
          if (role.managed) return { ok: false, label, detail: 'Rôle géré par une intégration : suppression impossible.' };
          const snapshot = { name: role.name, color: role.color };
          await role.delete(auditReason);
          return { ok: true, label, detail: `supprimé (snapshot : \`${JSON.stringify(snapshot)}\`)` };
        }
        case 'member.timeout': {
          const member = await guild.members.fetch(op.userId).catch(() => null);
          if (!member) return { ok: false, label, detail: 'Membre introuvable.' };
          const meMember = guild.members.me;
          if (!meMember) return { ok: false, label, detail: 'Bot non chargé.' };
          if (requesterMember) {
            this.moderation.assertHierarchy(requesterMember, member, meMember);
          }
          const entry = await this.moderation.timeout(guild, member, approverId, op.durationMs, op.reason ?? auditReason);
          return { ok: true, label, detail: `case #${entry.caseId}` };
        }
        case 'member.kick': {
          const member = await guild.members.fetch(op.userId).catch(() => null);
          if (!member) return { ok: false, label, detail: 'Membre introuvable.' };
          const meMember = guild.members.me;
          if (!meMember) return { ok: false, label, detail: 'Bot non chargé.' };
          if (requesterMember) {
            this.moderation.assertHierarchy(requesterMember, member, meMember);
          }
          const entry = await this.moderation.kick(guild, member, approverId, op.reason ?? auditReason);
          return { ok: true, label, detail: `case #${entry.caseId}` };
        }
        case 'member.ban': {
          if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission BanMembers." };
          }
          const user: User | null = await this.client.users.fetch(op.userId).catch(() => null);
          if (!user) return { ok: false, label, detail: 'Utilisateur introuvable.' };
          const entry = await this.moderation.ban(guild, user, approverId, op.reason ?? auditReason, false);
          return { ok: true, label, detail: `case #${entry.caseId}` };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, label, detail: message };
    }
  }

  private globalActiveSet(): Set<string> {
    return new Set(MODULE_CATALOG.filter((module) => moduleStateStore.isEnabled(module.id)).map((m) => m.id));
  }

  private async guildActiveSet(guildId: string): Promise<Set<string>> {
    const active = new Set<string>();
    for (const module of MODULE_CATALOG) {
      if (!moduleStateStore.isEnabled(module.id)) continue;
      if (await this.guildStates.isEnabled(guildId, module.id)) active.add(module.id);
    }
    return active;
  }
}
