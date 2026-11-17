import { Listener, On } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Events, type Message } from 'discord.js';
import { AssistantService } from '../assistant.service';
import { getValidatedEnv } from '../../../auth/env.accessor';
import { getLlm } from '../llm.accessor';
import { PrismaService } from '../../database/prisma.service';

const log = new Logger('AssistantListener');

const TRIAGE_TIMEOUT_MS = 12_000;

/** Alias normalisés (minuscules, sans espaces superflus) depuis l'env. */
function botNameVariants(): string[] {
  const env = getValidatedEnv();
  const names = [env.DISCORD_BOT_NAME, ...env.DISCORD_BOT_ALIASES.split(',')];
  return names.map((name) => name.trim().toLowerCase()).filter((name) => name.length >= 2);
}

/** Le contenu cite le bot par son nom ou un surnom, tapé en texte brut. */
function mentionsBotByName(content: string): boolean {
  const lowered = content.toLowerCase();
  return botNameVariants().some((name) => lowered.includes(name));
}

/** Mention Discord réelle OU nom/surnom tapé en texte brut. */
function isAddressedToBot(message: Message, meId: string): boolean {
  if (message.mentions.users.has(meId)) return true;
  return mentionsBotByName(message.content);
}

/**
 * Triage passif (salon dédié IA) : un modèle cheap décide si le bot doit
 * répondre à un message sans mention. OUI si adressé au bot, action Discord
 * demandée, question de suivi d'une conversation que le bot a initiée, ou
 * nouveau participant à présenter. NON si discussion entre humains sans le
 * bot, en cas de doute. Le transcript suffit : aucun historique persisté.
 */
async function shouldReplyInDedicated(message: Message, botUsername: string): Promise<boolean> {
  try {
    const recent = [...message.channel.messages.cache.values()]
      .filter((m) => !m.author.bot || m.author.id === botUsername)
      .slice(-8)
      .reverse()
      .map((m) => `[${m.author.username}] : ${(m.content || '(sans texte)').slice(0, 150)}`)
      .join('\n');
    const completion = await getLlm().chat(
      [
        {
          role: 'system',
          content: [
            'Tu décides si un bot Discord doit répondre à un message. Réponds UNIQUEMENT OUI ou NON.',
            'OUI si : le message s\u0027adresse au bot (question, demande, action Discord à faire), le fait de savoir (info utile pour la suite), ou poursuit une conversation que le bot a initiée.',
            'NON si : discussion entre humains qui ne concerne pas le bot, salutation générique sans demande, trolldom pur sans contenu, message vide ou réaction.',
            'En cas de doute : NON.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Derniers messages du salon :\n${recent || '(vide)'}\n\nNouveau message de ${message.author.username} : ${(message.content || '(sans texte)').slice(0, 300)}\n\nLe bot doit-il répondre ? OUI ou NON.`,
        },
      ],
      [],
      { userId: message.author.id, guildId: message.guildId ?? null, cause: 'triage' },
    );
    return /oui/i.test((completion.content ?? '').slice(0, 20));
  } catch {
    return false;
  }
}

/**
 * L'agent engage la conversation quand :
 * - il est mentionné (vraie mention Discord) ;
 * - son nom ou un surnom est tapé en texte brut (@10cordes sans autocomplétion, "10cordes", alias) ;
 * - le message est posté dans le salon dédié IA et le triage passif dit OUI ;
 * - le message répond directement à un de ses messages.
 * La demande part ensuite dans la file (FIFO par utilisateur).
 */
@Listener(Events.MessageCreate)
export class AssistantMentionListener {
  constructor(
    private readonly assistant: AssistantService,
    private readonly prisma: PrismaService,
  ) {}

  @On()
  async onMessageCreate(message: Message): Promise<void> {
    // Les webhooks passent (déclencheur d'intégrations) — pas les autres bots.
    if (message.author.bot && !message.webhookId) return;
    const guildId = message.guildId;
    if (!guildId) return;
    const me = message.client.user;
    if (!me) return;

    const addressed = isAddressedToBot(message, me.id);
    const inDedicatedChannel =
      (await this.assistant.dedicatedChannelId(guildId)) === message.channelId;
    const referencedAuthor = message.reference?.messageId
      ? message.channel.messages.cache.get(message.reference.messageId)?.author.id
      : undefined;
    const repliesToBot = referencedAuthor === me.id;

    log.info(
      `[GATE] salon=${message.channelId} mention=${message.mentions.users.has(me.id)} nom=${mentionsBotByName(message.content)} dédié=${inDedicatedChannel} réponse-bot=${repliesToBot}`,
    );

    // Salon dédié : écoute passive. Adressé directement => réponse. Sinon le
    // triage cheap décide (l'agent suit toujours la conversation). Chaque
    // message VU fait avancer le watermark de reprise au boot.
    if (inDedicatedChannel) {
      void this.prisma.channelWatermark
        .upsert({ where: { channelId: message.channelId }, create: { channelId: message.channelId, lastMessageId: message.id }, update: { lastMessageId: message.id } })
        .catch(() => {});
    }
    if (inDedicatedChannel && !addressed && !repliesToBot) {
      if (message.content.trim().length === 0) return;
      const shouldReply = await Promise.race([
        shouldReplyInDedicated(message, me.username),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), TRIAGE_TIMEOUT_MS).unref?.()),
      ]);
      if (!shouldReply) return;
      log.info(`[GATE] triage passif : réponse déclenchée pour ${message.author.username}`);
    } else if (!addressed && !repliesToBot) {
      return;
    }

    await this.assistant.enqueueMessage(message, repliesToBot);
  }
}
