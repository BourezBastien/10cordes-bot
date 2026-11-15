import { Listener } from '@spraxium/common';
import { Events, type Message } from 'discord.js';
import { AssistantService } from '../assistant.service';

/** Mention du bot → assistant en langage naturel avec tools du registry. */
@Listener(Events.MessageCreate)
export class AssistantMentionListener {
  constructor(private readonly assistant: AssistantService) {}

  async onMessageCreate(message: Message): Promise<void> {
    if (message.author.bot || !message.guild) return;
    const me = message.client.user;
    if (!me || !message.mentions.users.has(me.id)) return;

    await this.assistant.handleMention(message).catch(() => {});
  }
}
