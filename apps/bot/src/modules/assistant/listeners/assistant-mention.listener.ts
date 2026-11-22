import { Listener, On } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Events, MessageReferenceType, type Message } from 'discord.js';
import { AssistantService } from '../assistant.service';
import { getValidatedEnv } from '../../../auth/env.accessor';
import { PrismaService } from '../../database/prisma.service';

const log = new Logger('AssistantListener');

/**
 * GATE REFONDUE (décision 22/11) : chaîne courte, ZÉRO appel LLM, zéro liste
 * de noms à maintenir. Le triage passif est SUPPRIMÉ (19 % de réponses non
 * sollicitées mesurées ; bug botParticipated ; clauses trop larges).
 *
 * 1. Source : webhooks ALLOWLISTÉS uniquement (E2E_STAFF_WEBHOOK_IDS, rigs).
 *    Tout autre webhook est ignoré (fin des boucles bot-bot type Paul/MARK),
 *    tout vrai compte bot est ignoré.
 * 2. Mention d'un AUTRE bot sans nous → silence total (données Discord
 *    fiables, plus jamais d'alias env à maintenir).
 * 3. Salon dédié IA : tout message humain y est adressé au bot (c'est le
 *    but du salon ; boot-recovery suppose ce comportement).
 * 4. Ailleurs : uniquement mention réelle, notre nom en mot entier, ou
 *    réponse vérifiée à un de nos messages (messageReference + fetch).
 */

/** Nom du bot parsé UNE fois (l'ancien code reparseait l'env à chaque message). */
let cachedBotName: string | null = null;
function botName(): string {
  cachedBotName ??= getValidatedEnv().DISCORD_BOT_NAME.trim().toLowerCase();
  return cachedBotName;
}

/** Webhooks staff parsés une fois. */
let cachedStaffWebhooks: string[] | null = null;
function staffWebhookIds(): string[] {
  cachedStaffWebhooks ??= getValidatedEnv()
    .E2E_STAFF_WEBHOOK_IDS.split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return cachedStaffWebhooks;
}

/**
 * Le contenu cite le bot par son nom tapé en texte brut, en MOT ENTIER
 * (l'ancien `includes` laissait un alias court matcher un mot plus long).
 */
function mentionsBotByName(content: string): boolean {
  const name = botName();
  if (name.length < 2) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(content);
}

@Listener(Events.MessageCreate)
export class AssistantMentionListener {
  constructor(
    private readonly assistant: AssistantService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Réponse à un de NOS messages : résolue par messageReference réel
   * (MessageReferenceType.Default = vraie réponse, pas un forward), cache
   * d'abord puis FETCH de secours dans un try/catch. L'ancien code ne
   * regardait que le cache : une réponse à un message du bot plus ancien
   * que le cache (restart) n'était jamais reconnue.
   */
  private async resolvesRepliesToBot(message: Message, meId: string): Promise<boolean> {
    const ref = message.reference;
    if (!ref?.messageId) return false;
    if (ref.type !== undefined && ref.type !== MessageReferenceType.Default) return false;
    const cached = message.channel.messages.cache.get(ref.messageId);
    if (cached) return cached.author.id === meId;
    try {
      const referenced = await message.channel.messages.fetch(ref.messageId);
      return referenced.author.id === meId;
    } catch {
      return false;
    }
  }

  @On()
  async onMessageCreate(message: Message): Promise<void> {
    const me = message.client.user;
    const guildId = message.guildId;
    if (!me || !guildId) return;

    // 1. Source : seuls les webhooks allowlistés (rigs E2E) passent. Tout
    //    autre webhook (intégrations, relais d'autres bots) est ignoré.
    if (message.webhookId) {
      if (!staffWebhookIds().includes(message.webhookId)) return;
    } else if (message.author.bot) {
      return;
    }

    // 2. Adressé à un AUTRE bot (mention d'un bot sans nous) : silence,
    //    même en salon dédié.
    if (!message.mentions.users.has(me.id)) {
      const mentionsOtherBot = [...message.mentions.users.values()].some((user) => user.bot && user.id !== me.id);
      if (mentionsOtherBot) return;
    }

    const inDedicatedChannel = (await this.assistant.dedicatedChannelId(guildId)) === message.channelId;

    // Watermark de reprise au boot : chaque message VU dans le salon dédié
    // fait avancer le point de relecture (aucune demande perdue).
    if (inDedicatedChannel) {
      void this.prisma.channelWatermark
        .upsert({ where: { channelId: message.channelId }, create: { channelId: message.channelId, lastMessageId: message.id }, update: { lastMessageId: message.id } })
        .catch(() => {});
    }

    // 3-4. Interpellation explicite uniquement (plus aucun triage LLM).
    const repliesToBot = await this.resolvesRepliesToBot(message, me.id);
    const mentioned = message.mentions.users.has(me.id);
    const byName = !mentioned && mentionsBotByName(message.content);
    if (!inDedicatedChannel && !mentioned && !byName && !repliesToBot) return;

    log.info(
      `[GATE] accepté (dédié=${inDedicatedChannel} mention=${mentioned} nom=${byName} réponse-bot=${repliesToBot}) — ${message.author.username}`,
    );
    await this.assistant.enqueueMessage(message, repliesToBot);
  }
}
