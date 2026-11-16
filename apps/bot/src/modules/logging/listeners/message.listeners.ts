import { Listener, On } from '@spraxium/common';
import { Events, type Message, type PartialMessage } from 'discord.js';
import { LoggingService } from '../logging.service';

function describe(message: Message | PartialMessage): string | null {
  if (message.partial) return null;
  const author = message.author;
  if (author.bot) return null;
  return `<#${message.channelId}> · **${author.username}** (\`${message.id}\`)`;
}

@Listener(Events.MessageDelete)
export class MessageDeleteListener {
  constructor(private readonly logging: LoggingService) {}

  @On()
  async onMessageDelete(message: Message | PartialMessage): Promise<void> {
    const guildId = message.guildId;
    if (!guildId) return;
    const description = describe(message);
    if (!description) return;

    await this.logging.log(guildId, 'messages', {
      title: '## 🗑️ Message supprimé',
      lines: [description],
      accentColor: 0xe8_8b_94,
    });
  }
}

@Listener(Events.MessageUpdate)
export class MessageUpdateListener {
  constructor(private readonly logging: LoggingService) {}

  @On()
  async onMessageUpdate(oldMessage: Message | PartialMessage, newMessage: Message): Promise<void> {
    const guildId = newMessage.guildId;
    if (!guildId || newMessage.partial || newMessage.author.bot) return;
    if (oldMessage.partial || oldMessage.content === newMessage.content) return;

    const cut = (text: string): string => (text.length > 400 ? `${text.slice(0, 400)}…` : text);
    await this.logging.log(guildId, 'messages', {
      title: '## ✏️ Message modifié',
      lines: [
        `<#${newMessage.channelId}> · **${newMessage.author.username}** (\`${newMessage.id}\`)`,
        `**Avant** : ${cut(oldMessage.content ?? '(vide)')}`,
        `**Après** : ${cut(newMessage.content)}`,
      ],
      accentColor: 0xd9_b3_6b,
    });
  }
}
