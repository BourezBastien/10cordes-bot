import { Listener, On } from '@spraxium/common';
import { Events, type GuildMember, type Message, type PartialGuildMember } from 'discord.js';
import { AutomationsService } from './automations.service';

/**
 * Listeners Automations : événements Discord → automatisations du serveur.
 * Un @Listener PAR CLASSE (une classe = un event) : sans le décorateur de
 * classe, le framework ignore silencieusement les méthodes @On (bug fix du
 * 22/11, même cause que les 12 listeners d'audit morts).
 */
@Listener(Events.MessageCreate)
export class AutomationsMessageListener {
  constructor(private readonly automations: AutomationsService) {}

  @On()
  async onMessageCreate(message: Message): Promise<void> {
    if (message.author.bot) return;
    if (!message.guildId) return;
    await this.automations
      .handleEvent('message.created', {
        guildId: message.guildId,
        channelId: message.channelId,
        userId: message.author.id,
      }, message.content)
      .catch(() => {});
  }
}

@Listener(Events.GuildMemberAdd)
export class AutomationsMemberJoinListener {
  constructor(private readonly automations: AutomationsService) {}

  @On()
  async onGuildMemberAdd(member: GuildMember): Promise<void> {
    await this.automations
      .handleEvent('member.joined', { guildId: member.guild.id, channelId: member.guild.id, userId: member.id, member })
      .catch(() => {});
  }
}

@Listener(Events.GuildMemberRemove)
export class AutomationsMemberLeaveListener {
  constructor(private readonly automations: AutomationsService) {}

  @On()
  async onGuildMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
    await this.automations
      .handleEvent('member.left', { guildId: member.guild.id, channelId: member.guild.id, userId: member.id, member })
      .catch(() => {});
  }
}
