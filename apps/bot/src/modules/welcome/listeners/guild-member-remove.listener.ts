import { Listener, On } from '@spraxium/common';
import { Events, type GuildMember } from 'discord.js';
import { renderTemplate } from '@10cordes/shared';
import { GuildConfigService } from '../../guild-config/guild-config.service';
import { pendingWelcomeMessages, welcomeCacheKey } from '../welcome.state';

@Listener(Events.GuildMemberRemove)
export class GuildMemberRemoveListener {
  constructor(private readonly config: GuildConfigService) {}

  @On()
  async onGuildMemberRemove(member: GuildMember): Promise<void> {
    const guildId = member.guild.id;
    const config = await this.config.get(guildId);
    const vars = {
      'user.name': member.user?.username ?? 'un membre',
      'server.name': member.guild.name,
      'member.count': member.guild.memberCount,
    };

    // Suppression du message de bienvenue si l'option est active et que le départ est récent.
    if (config.welcome.enabled && config.welcome.deleteOnLeave) {
      const key = welcomeCacheKey(guildId, member.id);
      const messageId = pendingWelcomeMessages.get(key);
      if (messageId && config.welcome.channelId) {
        const channel = await member.guild.channels.fetch(config.welcome.channelId).catch(() => null);
        if (channel?.isTextBased()) {
          await channel.messages.delete(messageId).catch(() => {});
        }
      }
      pendingWelcomeMessages.delete(key);
    }

    if (config.farewell.enabled && config.farewell.channelId) {
      const channel = await member.guild.channels.fetch(config.farewell.channelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send(renderTemplate(config.farewell.template, vars)).catch(() => {});
      }
    }
  }
}
