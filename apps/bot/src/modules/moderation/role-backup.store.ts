import type { GuildMember } from 'discord.js';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../database/prisma.service';

/**
 * Sauvegarde et restauration des rôles d'un membre (table RoleBackup) : le
 * dérank photographie les rôles avant de les retirer, la restauration rejoue
 * la dernière photographie.
 */
export class RoleBackupStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async derank(member: GuildMember, moderatorId: string, reason: string | null): Promise<number> {
    const roleIds = [...member.roles.cache.keys()].filter((roleId) => roleId !== member.guild.id);
    await this.prisma.roleBackup.create({
      data: {
        guildId: member.guild.id,
        userId: member.id,
        roleIds: JSON.stringify(roleIds),
        createdBy: moderatorId,
      },
    });
    const removable = roleIds
      .map((roleId) => member.roles.cache.get(roleId))
      .filter((role): role is NonNullable<typeof role> => role !== undefined && !role.managed);
    await member.roles.remove(removable, reason ?? 'derank');
    this.audit.record({
      guildId: member.guild.id,
      source: 'discord',
      action: 'mod.derank',
      actorId: moderatorId,
      targetId: member.id,
      metadata: { roles: roleIds.length, reason },
    });
    return roleIds.length;
  }

  async restoreRoles(member: GuildMember, moderatorId: string): Promise<number> {
    const backup = await this.prisma.roleBackup.findFirst({
      where: { guildId: member.guild.id, userId: member.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!backup) return 0;

    const roleIds = (JSON.parse(backup.roleIds) as string[]).filter((roleId) =>
      member.guild.roles.cache.has(roleId),
    );
    await member.roles.add(roleIds, 'role restore').catch(() => {});
    this.audit.record({
      guildId: member.guild.id,
      source: 'discord',
      action: 'mod.restoreRoles',
      actorId: moderatorId,
      targetId: member.id,
      metadata: { restored: roleIds.length },
    });
    return roleIds.length;
  }
}
