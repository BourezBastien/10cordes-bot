import { Listener, On } from '@spraxium/common';
import { Events, type GuildMember } from 'discord.js';
import { renderTemplate } from '@10cordes/shared';
import { GuildConfigService } from '../../guild-config/guild-config.service';
import { pendingWelcomeMessages, welcomeCacheKey } from '../welcome.state';

@Listener(Events.GuildMemberAdd)
export class GuildMemberAddListener {
  constructor(private readonly config: GuildConfigService) {}

  @On()
  async onGuildMemberAdd(member: GuildMember): Promise<void> {
    const config = await this.config.get(member.guild.id);
    const vars = {
      'user.mention': member.toString(),
      'user.name': member.user.username,
      'server.name': member.guild.name,
      'member.count': member.guild.memberCount,
    };

    if (config.welcome.enabled && config.welcome.channelId) {
      const channel = await member.guild.channels.fetch(config.welcome.channelId).catch(() => null);
      if (channel?.isTextBased()) {
        const message = await channel.send(renderTemplate(config.welcome.template, vars)).catch(() => null);
        if (message && config.welcome.deleteOnLeave) {
          pendingWelcomeMessages.set(welcomeCacheKey(member.guild.id, member.id), message.id);
        }
      }
    }

    if (config.welcome.autoRoleId) {
      await member.roles.add(config.welcome.autoRoleId).catch(() => {});
    }
  }
}
