import { type ExecutionContext, Guard, type SpraxiumGuard } from '@spraxium/common';
import { PermissionFlagsBits, type APIInteractionGuildMember, type GuildMember } from 'discord.js';
import { getModuleManager } from './module-manager.service';

/**
 * Blocks commands of disabled modules (global + per-guild), inactive dependencies,
 * channel whitelists, required roles, cooldowns and mod quotas.
 * Unknown commands pass through so the module manager itself stays reachable.
 */
@Guard()
export class ModuleEnabledGuard implements SpraxiumGuard {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const manager = getModuleManager();
    // Groupe de sous-commandes du /setup : source de résolution du module
    // (une seule commande racine, une catégorie par module).
    const raw = ctx.getInteraction() as {
      options?: { getSubcommandGroup?: (f: false) => string | null };
    };
    const group = raw.options?.getSubcommandGroup?.(false) ?? undefined;
    await manager.assertCommandUsable({
      guildId: ctx.getGuildId(),
      userId: ctx.getUserId(),
      channelId: ctx.getChannelId(),
      memberRoleIds: extractRoleIds(ctx.getMember()),
      isAdministrator: ctx.getMemberPermissions()?.has(PermissionFlagsBits.Administrator) ?? false,
      commandName: ctx.getCommandName(),
      commandGroup: group,
    });
    return true;
  }
}

function extractRoleIds(member: GuildMember | APIInteractionGuildMember | null): string[] {
  if (!member) return [];
  // API guild member (interactions hors cache) expose roles: string[] | undefined.
  if (Array.isArray(member.roles)) return member.roles;
  return [...member.roles.cache.keys()];
}
