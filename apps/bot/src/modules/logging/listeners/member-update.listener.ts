import { Listener, On } from '@spraxium/common';
import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { GuildConfigService } from '../../guild-config/guild-config.service';
import { LoggingService } from '../logging.service';

function describe(member: GuildMember | PartialGuildMember): string {
  return `**${member.user?.username ?? 'un membre'}** (\`${member.id}\`)`;
}

@Listener(Events.GuildMemberUpdate)
export class MemberUpdateListener {
  constructor(
    private readonly logging: LoggingService,
    private readonly config: GuildConfigService,
  ) {}

  @On()
  async onGuildMemberUpdate(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): Promise<void> {
    const guildConfig = await this.config.get(newMember.guild.id);
    const ignoredRoles = new Set(guildConfig.logs.ignoredRoles);
    const lines: string[] = [];

    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    for (const [roleId] of newRoles) {
      if (oldRoles.has(roleId) || ignoredRoles.has(roleId)) continue;
      lines.push(`➕ Rôle ajouté : <@&${roleId}>`);
    }
    for (const [roleId] of oldRoles) {
      if (newRoles.has(roleId) || ignoredRoles.has(roleId)) continue;
      lines.push(`➖ Rôle retiré : <@&${roleId}>`);
    }

    if (oldMember.nickname !== newMember.nickname) {
      lines.push(`📝 Pseudo : \`${oldMember.nickname ?? '—'}\` → \`${newMember.nickname ?? '—'}\``);
    }

    if (lines.length === 0) return;
    await this.logging.log(newMember.guild.id, 'members', {
      title: '## 👤 Membre mis à jour',
      lines: [describe(newMember), ...lines],
    });
  }
}
