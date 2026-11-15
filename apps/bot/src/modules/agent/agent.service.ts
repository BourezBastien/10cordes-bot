import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { PermissionFlagsBits, type Client, type Guild, type GuildMember, type User } from 'discord.js';
import { AdminOpSchema, DESTRUCTIVE_OP_TYPES, opLabel, type AgentPlanInput, type AdminOp } from '@10cordes/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { ModerationService } from '../moderation/moderation.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { agentTools } from './tools/discord.tools';
import { AdminWhitelistService } from './whitelist.service';

export interface PlanOpResult {
  ok: boolean;
  label: string;
  detail?: string;
}

const PLAN_TTL_MS = 5 * 60 * 1_000;

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
    private readonly registry: ToolRegistryService,
  ) {}

  /** Enregistre les tools discord.* dans le registry (boot, après le ToolRegistryModule). */
  async onBoot(): Promise<void> {
    for (const tool of agentTools(this, this.client)) {
      this.registry.register(tool);
    }
  }

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
      action: "agent.plan.created",
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
    return this.prisma.agentPlan.findFirst({
      where: { guildId, channelId, status: "pending" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
  }

  /**
   * Confirmation : le CLIQUEUR est autorisé ici (règle n°3) — whitelist/owner
   * pour les plans destructifs, ManageGuild sinon. Expiration = annulation.
   */
  async resolve(
    planId: string,
    approverId: string,
    action: "approve" | "cancel",
  ): Promise<{
    status: "executed" | "cancelled" | "expired" | "denied" | "notfound";
    results?: PlanOpResult[];
    denialReason?: string;
  }> {
    const plan = await this.prisma.agentPlan.findUnique({ where: { id: planId } });
    if (!plan || plan.status !== "pending") return { status: "notfound" };
    if (plan.expiresAt.getTime() < Date.now()) {
      await this.prisma.agentPlan.update({ where: { id: planId }, data: { status: "expired" } });
      return { status: "expired" };
    }

    const guild = this.client.guilds.cache.get(plan.guildId);
    if (!guild) return { status: "notfound" };

    if (action === "cancel") {
      await this.prisma.agentPlan.update({
        where: { id: planId },
        data: { status: "cancelled", approvedBy: approverId },
      });
      this.audit.record({
        guildId: plan.guildId,
        source: "agent",
        action: "agent.plan.cancelled",
        actorId: approverId,
        metadata: { planId },
      });
      return { status: "cancelled" };
    }

    const ops = (JSON.parse(plan.ops) as AdminOp[]).map((op) => AdminOpSchema.parse(op));
    const hasDestructive = ops.some((op) => DESTRUCTIVE_OP_TYPES.has(op.type));

    // Gate d'approbation : owner/whitelist si destructif, ManageGuild sinon.
    const approverIsOwner = guild.ownerId === approverId;
    const approverWhitelisted = approverIsOwner || (await this.whitelist.isWhitelisted(plan.guildId, approverId));
    if (hasDestructive && !approverWhitelisted) {
      this.audit.record({
        guildId: plan.guildId,
        source: "agent",
        action: "agent.plan.denied",
        actorId: approverId,
        metadata: { planId, reason: "not whitelisted" },
      });
      return {
        status: "denied",
        denialReason: "Ce plan contient des ops destructives — réservées au owner et à la whitelist.",
      };
    }
    const approverMember = await guild.members.fetch(approverId).catch(() => null);
    if (!hasDestructive && approverMember && !approverMember.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return { status: "denied", denialReason: "Permission ManageGuild requise pour approuver ce plan." };
    }

    const requesterMember = await guild.members.fetch(plan.requesterId).catch(() => null);
    const results: PlanOpResult[] = [];
    for (const [index, op] of ops.entries()) {
      const result = await this.executeOp(guild, op, plan.requesterId, requesterMember, approverId);
      results.push(result);
      this.audit.record({
        guildId: plan.guildId,
        source: "agent",
        action: `agent.op.${op.type}`,
        actorId: approverId,
        metadata: { planId, requesterId: plan.requesterId, ok: result.ok, detail: result.detail ?? null },
      });
      void index;
    }

    await this.prisma.agentPlan.update({
      where: { id: planId },
      data: { status: "executed", approvedBy: approverId, results: JSON.stringify(results) },
    });
    return { status: "executed", results };
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
        case "channel.create": {
          if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission ManageChannels." };
          }
          const created = await guild.channels.create({
            name: op.name,
            type: op.kind === "voice" ? 2 : op.kind === "category" ? 4 : 0,
            topic: op.topic,
            reason: auditReason,
          });
          return { ok: true, label, detail: `créé → <#${created.id}>` };
        }
        case "channel.rename": {
          if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission ManageChannels." };
          }
          const channel = await this.client.channels.fetch(op.channelId).catch(() => null);
          if (!channel || !("setName" in channel)) return { ok: false, label, detail: "Salon introuvable." };
          await channel.setName(op.name, auditReason);
          return { ok: true, label, detail: `renommé en **${op.name}**` };
        }
        case "channel.archive": {
          if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission ManageChannels." };
          }
          const channel = await this.client.channels.fetch(op.channelId).catch(() => null);
          if (!channel || !("setName" in channel)) return { ok: false, label, detail: "Salon introuvable." };
          const snapshot = {
            name: channel.name,
            type: channel.type,
            topic: "topic" in channel ? (channel.topic as string | null) : null,
          };
          await channel.setName(`archive-${channel.name}`, auditReason);
          return { ok: true, label, detail: `archivé — snapshot : \`${JSON.stringify(snapshot)}\`` };
        }
        case "channel.delete": {
          // Archive-first : snapshot → suppression (l'op destructif n'arrive ici
          // qu'après confirmation whitelist ; le snapshot est la trace restaurable).
          if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission ManageChannels." };
          }
          const channel = await this.client.channels.fetch(op.channelId).catch(() => null);
          if (!channel || !("delete" in channel)) return { ok: false, label, detail: "Salon introuvable." };
          const deletable = channel as import('discord.js').GuildChannel;
          const snapshot = {
            name: deletable.name,
            type: deletable.type,
          };
          await deletable.delete(auditReason);
          return { ok: true, label, detail: `supprimé — snapshot restaurable : \`${JSON.stringify(snapshot)}\`` };
        }
        case "role.create": {
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
        case "role.rename": {
          if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission ManageRoles." };
          }
          const role = await guild.roles.fetch(op.roleId).catch(() => null);
          if (!role) return { ok: false, label, detail: "Rôle introuvable." };
          await role.setName(op.name, auditReason);
          return { ok: true, label, detail: `renommé en **${op.name}**` };
        }
        case "role.delete": {
          if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission ManageRoles." };
          }
          const role = await guild.roles.fetch(op.roleId).catch(() => null);
          if (!role) return { ok: false, label, detail: "Rôle introuvable." };
          if (role.managed) return { ok: false, label, detail: "Rôle géré par une intégration — suppression impossible." };
          const snapshot = { name: role.name, color: role.color };
          await role.delete(auditReason);
          return { ok: true, label, detail: `supprimé — snapshot : \`${JSON.stringify(snapshot)}\`` };
        }
        case "member.timeout": {
          const member = await guild.members.fetch(op.userId).catch(() => null);
          if (!member) return { ok: false, label, detail: "Membre introuvable." };
          const meMember = guild.members.me;
          if (!meMember) return { ok: false, label, detail: "Bot non chargé." };
          if (requesterMember) {
            this.moderation.assertHierarchy(requesterMember, member, meMember);
          }
          const entry = await this.moderation.timeout(guild, member, approverId, op.durationMs, op.reason ?? auditReason);
          return { ok: true, label, detail: `case #${entry.caseId}` };
        }
        case "member.kick": {
          const member = await guild.members.fetch(op.userId).catch(() => null);
          if (!member) return { ok: false, label, detail: "Membre introuvable." };
          const meMember = guild.members.me;
          if (!meMember) return { ok: false, label, detail: "Bot non chargé." };
          if (requesterMember) {
            this.moderation.assertHierarchy(requesterMember, member, meMember);
          }
          const entry = await this.moderation.kick(guild, member, approverId, op.reason ?? auditReason);
          return { ok: true, label, detail: `case #${entry.caseId}` };
        }
        case "member.ban": {
          if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
            return { ok: false, label, detail: "Le bot n'a pas la permission BanMembers." };
          }
          const user: User | null = await this.client.users.fetch(op.userId).catch(() => null);
          if (!user) return { ok: false, label, detail: "Utilisateur introuvable." };
          const entry = await this.moderation.ban(guild, user, approverId, op.reason ?? auditReason, false);
          return { ok: true, label, detail: `case #${entry.caseId}` };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, label, detail: message };
    }
  }
}
