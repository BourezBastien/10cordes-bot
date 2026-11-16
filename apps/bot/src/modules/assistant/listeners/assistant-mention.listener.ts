import { Listener, On } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Events, type Message } from 'discord.js';
import { AssistantService } from '../assistant.service';

const log = new Logger('AssistantListener');

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
    const guildId = message.guildId;
    if (!guildId) return;
    const me = message.client.user;
    if (!me) return;

    const mentioned = message.mentions.users.has(me.id);
    const inDedicatedChannel =
      (await this.assistant.dedicatedChannelId(guildId)) === message.channelId;
    const referencedAuthor = message.reference?.messageId
      ? message.channel.messages.cache.get(message.reference.messageId)?.author.id
      : undefined;
    const repliesToBot = referencedAuthor === me.id;

    log.info(
      `[GATE] salon=${message.channelId} mention=${mentioned} dédié=${inDedicatedChannel} réponse-bot=${repliesToBot}`,
    );

    if (!mentioned && !inDedicatedChannel && !repliesToBot) return;

    await this.assistant.enqueueMessage(message, repliesToBot);
  }
}
