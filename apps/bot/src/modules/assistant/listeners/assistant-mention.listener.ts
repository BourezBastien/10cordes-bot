import { Listener, On } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Events, MessageReferenceType, type Message } from 'discord.js';
import { AssistantService } from '../assistant.service';
import { getValidatedEnv } from '../../../auth/env.accessor';
import { PrismaService } from '../../database/prisma.service';
import { GuildRulesService } from '../../rules/guild-rules.service';
import { fileLog } from '../../logging/file-log.service';

const log = new Logger('AssistantListener');

/**
 * GATE REFONDUE (22/11 + R0.1) : chaîne courte, ZÉRO appel LLM, zéro liste
 * de noms à maintenir. Le triage passif reste SUPPRIMÉ.
 *
 * 1. Source : webhooks STAFF auto-reconnus uniquement (créés par le bot,
 *    nommés agent-e2e-guardian, E2E_ENABLED) ; tout autre webhook ou vrai
 *    compte bot est ignoré.
 * 2. Mention d'un AUTRE bot sans nous → silence.
 * 3. Salon dédié IA : tout message humain y est adressé au bot.
 * 4. RÈGLES SERVEUR (GuildRule) : en zone libre (catégorie/salon listé),
 *    le nom en texte brut déclenche aussi ; hors zone libre avec
 *    strictMentionElsewhere, SEULE une vraie mention @ ou une réponse
 *    directe déclenche (le nom texte est ignoré).
 * 5. Partout : le nom en texte brut est testé sur un contenu NETTOYÉ
 *    (URLs, blocs de code, mentions retirées) — un lien GitHub contenant
 *    le nom du bot ne déclenche JAMAIS.
 */

/** Webhooks staff parsés une fois (E2E : nom créé par les rigs eux-mêmes). */
let cachedStaffWebhookNames: string[] | null = null;
function staffWebhookNames(): string[] {
  cachedStaffWebhookNames ??= ['agent-e2e-guardian'];
  return cachedStaffWebhookNames;
}

/**
 * Contenu NETTOYÉ pour la détection du nom : URLs, blocs de code (``` et `),
 * inline code, mentions/channels/slash-commandes retirés. Un lien
 * github.com/x/10cordes-bot ne contient plus le mot détectable.
 */
function cleanForNameDetection(content: string): string {
  return content
    .replace(/https?:\/\/\S+/gu, ' ')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`[^`\n]*`/gu, ' ')
    .replace(/<\/?[a@:#]?[0-9A-Za-z_]+(:\d+>)?/gu, ' ')
    .replace(/<[a@#]\d+>/gu, ' ')
    .replace(/<\/?[a-z]+:\d+>/gu, ' ');
}

/**
 * Le contenu cite le bot par son nom tapé en texte brut, en MOT ENTIER sur
 * le contenu NETTOYÉ (l'ancien `includes` laissait un alias court matcher
 * un mot plus long ; les URLs ne comptent plus du tout).
 */
function mentionsBotByName(username: string, content: string): boolean {
  const name = username.trim().toLowerCase();
  if (name.length < 2) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(cleanForNameDetection(content));
}

@Listener(Events.MessageCreate)
export class AssistantMentionListener {
  constructor(
    private readonly assistant: AssistantService,
    private readonly prisma: PrismaService,
    private readonly rules: GuildRulesService,
  ) {}

  /**
   * Réponse à un de NOS messages : résolue par messageReference réel
   * (MessageReferenceType.Default = vraie réponse), cache d'abord puis
   * FETCH de secours dans un try/catch.
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

    // 1. Source : seuls les webhooks auto-créés par le bot pour les rigs
    //    passent (reconnaissance par nom, E2E_ENABLED requis — le webhook
    //    agent-e2e-guardian est créé PAR le bot via son token, c'est la clé).
    if (message.webhookId) {
      const e2eEnabled = getValidatedEnv().E2E_ENABLED === 'true';
      const webhookName = (message.author?.username ?? '').toLowerCase();
      if (!(e2eEnabled && staffWebhookNames().includes(webhookName))) return;
    } else if (message.author.bot) {
      return;
    }

    // 2. Adressé à un AUTRE bot (mention d'un bot sans nous) : silence.
    if (!message.mentions.users.has(me.id)) {
      const mentionsOtherBot = [...message.mentions.users.values()].some((user) => user.bot && user.id !== me.id);
      if (mentionsOtherBot) return;
    }

    const inDedicatedChannel = (await this.assistant.dedicatedChannelId(guildId)) === message.channelId;

    // R0.1 : zone libre (GuildRule) — catégorie parente ou salon listé.
    const channel = message.channel;
    const parentCategoryId = channel.isThread() ? channel.parentId : ('parentId' in channel ? channel.parentId : null);
    const freeZone = await this.rules.isFreeZone(guildId, message.channelId, parentCategoryId);

    // Watermark de reprise au boot : chaque message VU dans le salon dédié.
    if (inDedicatedChannel) {
      void this.prisma.channelWatermark
        .upsert({ where: { channelId: message.channelId }, create: { channelId: message.channelId, lastMessageId: message.id }, update: { lastMessageId: message.id } })
        .catch(() => {});
    }

    // 3-5. Interpellation : dédié = tout ; sinon mention/reply TOUJOURS,
    // nom texte seulement en zone libre (strictMentionElsewhere par défaut).
    const repliesToBot = await this.resolvesRepliesToBot(message, me.id);
    const mentioned = message.mentions.users.has(me.id);
    const byName = !mentioned && mentionsBotByName(me.username, message.content);
    const nameAllowed = freeZone || inDedicatedChannel || !(await this.rules.get(guildId)).strictMentionElsewhere;
    if (!inDedicatedChannel && !mentioned && !repliesToBot && !(byName && nameAllowed)) return;

    log.info(
      `[GATE] accepté (dédié=${inDedicatedChannel} mention=${mentioned} nom=${byName && nameAllowed} réponse-bot=${repliesToBot} zone-libre=${freeZone}) — ${message.author.username}`,
    );
    fileLog()?.event('info', 'gate', 'accept', {
      guildId,
      channelId: message.channelId,
      dedicated: inDedicatedChannel,
      mention: mentioned,
      name: byName && nameAllowed,
      reply: repliesToBot,
      freeZone,
    });
    await this.assistant.enqueueMessage(message, repliesToBot);
  }
}
