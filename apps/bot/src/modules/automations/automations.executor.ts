import type { Logger } from '@spraxium/logger';
import type { Client } from 'discord.js';
import { z } from 'zod';
import { botPermissionPolicy } from '../../core/security/bot-permission.policy';
import { renderTemplate } from '@10cordes/shared';
import type { AuditService } from '../audit/audit.service';
import { ActionSchema, type AgentAutomationRow, type AutomationEventContext } from './automations.schemas';

/**
 * Exécution des actions d'une automatisation (effets Discord + audit).
 * Collaborateur non injectable : instancié par AutomationsService, qui lui
 * fournit le client, l'audit et son logger.
 */
export class AutomationExecutor {
  constructor(
    private readonly client: Client,
    private readonly audit: AuditService,
    private readonly log: Logger,
  ) {}

  async executeActions(row: AgentAutomationRow, ctx: AutomationEventContext): Promise<void> {
    const guild = this.client.guilds.cache.get(ctx.guildId);
    if (!guild) return;
    let actions: Array<z.infer<typeof ActionSchema>> = [];
    try {
      actions = z.array(ActionSchema).parse(JSON.parse(row.actions ?? '[]'));
    } catch {
      this.log.warn(`Actions illisibles pour « ${row.name} » : ignorées.`);
      return;
    }

    const me = guild.members.me;
    const member = ctx.member ?? (ctx.userId ? await guild.members.fetch(ctx.userId).catch(() => null) : null);
    // Vocabulaire de templates UNIFIÉ ({{user.mention}} etc., comme welcome)
    // + les clés courtes historiques conservées pour compat des automatisations existantes.
    const vars = {
      user: ctx.userId ? `<@${ctx.userId}>` : '',
      'user.name': member?.displayName ?? '',
      'user.mention': ctx.userId ? `<@${ctx.userId}>` : '',
      server: guild.name,
      'server.name': guild.name,
      count: String(guild.memberCount),
      'member.count': String(guild.memberCount),
    };
    const render = (text: string): string => renderTemplate(text, vars);

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'sendMessage': {
            if (!botPermissionPolicy.canInGuild(guild, 'SendMessages')) throw new Error(botPermissionPolicy.refusal('SendMessages'));
            const channel = await this.client.channels.fetch(action.channelId).catch(() => null);
            if (!channel?.isTextBased() || !('send' in channel)) throw new Error('Salon de destination introuvable.');
            await channel.send(render(action.content));
            break;
          }
          case 'sendDm': {
            if (!ctx.userId) throw new Error('Aucun utilisateur cible pour le DM.');
            const target = await guild.members.fetch(ctx.userId).catch(() => null);
            if (!target) throw new Error('Membre cible introuvable.');
            await target.send(render(action.content)).catch(() => {
              throw new Error('DM fermés.');
            });
            break;
          }
          case 'addRole': {
            if (!botPermissionPolicy.canInGuild(guild, 'ManageRoles')) throw new Error(botPermissionPolicy.refusal('ManageRoles'));
            if (!member) throw new Error('Membre cible introuvable.');
            await member.roles.add(action.roleId, `automation « ${row.name} »`);
            break;
          }
          case 'removeRole': {
            if (!botPermissionPolicy.canInGuild(guild, 'ManageRoles')) throw new Error(botPermissionPolicy.refusal('ManageRoles'));
            if (!member) throw new Error('Membre cible introuvable.');
            await member.roles.remove(action.roleId, `automation « ${row.name} »`);
            break;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log.warn(`Action ${action.type} échouée (« ${row.name} ») : ${message}`);
        this.audit.record({
          guildId: ctx.guildId,
          source: 'agent',
          action: 'automation.action.failed',
          metadata: { automation: row.name, type: action.type, reason: message.slice(0, 200) },
        });
      }
    }
    this.audit.record({
      guildId: ctx.guildId,
      source: 'agent',
      action: 'automation.executed',
      metadata: { automation: row.name, trigger: row.triggerType, actions: actions.length },
    });
  }
}
