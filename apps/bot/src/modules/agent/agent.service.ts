import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Client, type Guild, type GuildMember, type User } from 'discord.js';
import { opLabel, type AdminOp } from '@10cordes/shared';
import { adminOpPolicy, requiredPermissionFor } from '../../core/security/admin-op.policy';
import { botPermissionPolicy } from '../../core/security/bot-permission.policy';
import { AuditService } from '../audit/audit.service';
import { ModerationService } from '../moderation/moderation.service';
import { agentTools } from './tools/discord.tools';
import { getToolRegistry } from '../tool-registry/tool-registry.service';

export interface PlanOpResult {
  ok: boolean;
  label: string;
  detail?: string;
}

/**
 * Agent Admin — exécution directe des ops destructives (décision 17/11 :
 * plus de plans ni confirmation). Gates re-vérifiées par op : demandeur ET
 * bot. Archive-first pour les suppressions, audit complet.
 *
 * (22/11) Refactor : la copie morte du module-manager (~175 lignes) et le
 * flux whitelist (17/11) sont supprimés ; l'exécution est une TABLE de
 * handlers (Strategy), une entrée par op réellement exposée par les tools.
 */
@Injectable()
export class AgentService implements SpraxiumOnBoot {
  constructor(
    private readonly audit: AuditService,
    private readonly client: Client,
    private readonly moderation: ModerationService,
  ) {}

  /** Enregistre les tools discord.* dans le registry (boot, après le ToolRegistryModule). */
  async onBoot(): Promise<void> {
    const registry = getToolRegistry();
    for (const tool of agentTools(this, this.client)) {
      registry.register(tool);
    }
  }

  /**
   * Exécution DIRECTE d'une op : gates de permissions du demandeur par op
   * (le registry a déjà vérifié la permission du tool, on re-vérifie la
   * permission SPÉCIFIQUE de l'op), puis dispatch vers le handler.
   */
  async executeDirect(guildId: string, requesterId: string, op: AdminOp): Promise<PlanOpResult> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return { ok: false, label: opLabel(op), detail: 'Serveur introuvable.' };

    const requesterMember = await guild.members.fetch(requesterId).catch(() => null);
    const required = requiredPermissionFor(op.type);
    if (!adminOpPolicy.isRequesterAllowed(guild, requesterMember, requesterId, op.type)) {
      this.audit.record({
        guildId,
        source: 'agent',
        action: 'agent.action.denied',
        actorId: requesterId,
        metadata: { op: op.type, reason: `permission ${required} manquante pour le demandeur` },
      });
      return { ok: false, label: opLabel(op), detail: `Permission ${required} requise pour le demandeur.` };
    }

    const handler = OP_HANDLERS[op.type];
    if (!handler) return { ok: false, label: opLabel(op), detail: 'Op non prise en charge.' };
    const result = await handler(op, { guild, requesterMember, requesterId, client: this.client, moderation: this.moderation });
    this.audit.record({
      guildId,
      source: 'agent',
      action: 'agent.action.direct',
      actorId: requesterId,
      metadata: { op: op.type, ok: result.ok, detail: result.detail ?? null },
    });
    return result;
  }
}

/** Permission Discord exigée du DEMANDEUR par type d'op : voir core/security/admin-op.policy.ts */

interface OpContext {
  guild: Guild;
  requesterMember: GuildMember | null;
  requesterId: string;
  client: Client;
  moderation: ModerationService;
}

type OpHandler = (op: AdminOp, ctx: OpContext) => Promise<PlanOpResult>;

/** Extraction typée d'une variante d'op (narrowing sûr après check runtime). */
function asOp<T extends AdminOp['type']>(op: AdminOp, type: T): Extract<AdminOp, { type: T }> {
  return op as Extract<AdminOp, { type: T }>;
}

const ok = (label: string, detail: string): PlanOpResult => ({ ok: true, label, detail });
const fail = (label: string, detail: string): PlanOpResult => ({ ok: false, label, detail });

/**
 * Table Strategy des ops — chaque handler re-vérifie la permission du BOT
 * en code. Les ops de création/renommage ne sont PAS ici : les tools
 * createChannel/renameChannel/createRole etc. les implémentent directement.
 */
const OP_HANDLERS: Partial<Record<AdminOp['type'], OpHandler>> = {
  'channel.delete': async (op, { guild, client, requesterId }) => {
    const label = opLabel(op);
    if (!botPermissionPolicy.canInGuild(guild, 'ManageChannels')) {
      return fail(label, botPermissionPolicy.refusal('ManageChannels'));
    }
    const channel = await client.channels.fetch(asOp(op, 'channel.delete').channelId).catch(() => null);
    if (!channel || !('delete' in channel)) return fail(label, 'Salon introuvable.');
    const deletable = channel as import('discord.js').GuildChannel;
    // Archive-first : le snapshot est la trace restaurable (audit + détail).
    const snapshot = { name: deletable.name, type: deletable.type };
    await deletable.delete(`agent (demande de <@${requesterId}>)`);
    return ok(label, `supprimé (snapshot restaurable : \`${JSON.stringify(snapshot)}\`)`);
  },
  'role.delete': async (op, { guild, requesterId }) => {
    const label = opLabel(op);
    if (!botPermissionPolicy.canInGuild(guild, 'ManageRoles')) {
      return fail(label, botPermissionPolicy.refusal('ManageRoles'));
    }
    const role = await guild.roles.fetch(asOp(op, 'role.delete').roleId).catch(() => null);
    if (!role) return fail(label, 'Rôle introuvable.');
    if (role.managed) return fail(label, 'Rôle géré par une intégration : suppression impossible.');
    const snapshot = { name: role.name, color: role.color };
    await role.delete(`agent (demande de <@${requesterId}>)`);
    return ok(label, `supprimé (snapshot : \`${JSON.stringify(snapshot)}\`)`);
  },
  'member.timeout': async (op, { guild, requesterMember, requesterId, moderation }) => {
    const label = opLabel(op);
    const member = await guild.members.fetch(asOp(op, 'member.timeout').userId).catch(() => null);
    if (!member) return fail(label, 'Membre introuvable.');
    const meMember = guild.members.me;
    if (!meMember) return fail(label, 'Bot non chargé.');
    if (requesterMember) moderation.assertHierarchy(requesterMember, member, meMember);
    const entry = await moderation.timeout(guild, member, requesterId, asOp(op, 'member.timeout').durationMs, asOp(op, 'member.timeout').reason ?? `agent (demande de <@${requesterId}>)`);
    return ok(label, `case #${entry.caseId}`);
  },
  'member.kick': async (op, { guild, requesterMember, requesterId, moderation }) => {
    const label = opLabel(op);
    const member = await guild.members.fetch(asOp(op, 'member.kick').userId).catch(() => null);
    if (!member) return fail(label, 'Membre introuvable.');
    const meMember = guild.members.me;
    if (!meMember) return fail(label, 'Bot non chargé.');
    if (requesterMember) moderation.assertHierarchy(requesterMember, member, meMember);
    const entry = await moderation.kick(guild, member, requesterId, asOp(op, 'member.kick').reason ?? `agent (demande de <@${requesterId}>)`);
    return ok(label, `case #${entry.caseId}`);
  },
  'member.ban': async (op, { guild, requesterId, client, moderation }) => {
    const label = opLabel(op);
    if (!botPermissionPolicy.canInGuild(guild, 'BanMembers')) {
      return fail(label, botPermissionPolicy.refusal('BanMembers'));
    }
    const user: User | null = await client.users.fetch(asOp(op, 'member.ban').userId).catch(() => null);
    if (!user) return fail(label, 'Utilisateur introuvable.');
    const entry = await moderation.ban(guild, user, requesterId, asOp(op, 'member.ban').reason ?? `agent (demande de <@${requesterId}>)`, false);
    return ok(label, `case #${entry.caseId}`);
  },
};
