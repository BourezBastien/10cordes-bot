import { Listener, On } from '@spraxium/common';
import { Events, type Message } from 'discord.js';
import { AssistantService } from '../assistant.service';

/**
 * L'agent engage la conversation quand :
 * - le bot est mentionné ;
 * - le message est posté dans le salon dédié IA (si configuré) ;
 * - le message répond directement à un message du bot.
 * La demande part ensuite dans la file (FIFO par utilisateur).
 */
@Listener(Events.MessageCreate)
export class AssistantMentionListener {
  constructor(private readonly assistant: AssistantService) {}

  @On()
  async onMessageCreate(message: Message): Promise<void> {
    // Les webhooks passent (déclencheur d'intégrations) — pas les autres bots.
    if (message.author.bot && !message.webhookId) return;
    if (!message.guild) return;
    const me = message.client.user;
    if (!me) return;

    const mentioned = message.mentions.users.has(me.id);
    const inDedicatedChannel = (await this.assistant.dedicatedChannelId()) === message.channelId;
    const referencedAuthor = message.reference?.messageId
      ? message.channel.messages.cache.get(message.reference.messageId)?.author.id
      : undefined;
    const repliesToBot = referencedAuthor === me.id;

    if (!mentioned && !inDedicatedChannel && !repliesToBot) return;

    this.assistant.enqueue(message);
  }
}
