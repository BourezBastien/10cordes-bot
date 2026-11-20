import { Listener, On } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Events, type Message } from 'discord.js';
import { AssistantService } from '../assistant.service';
import { getValidatedEnv } from '../../../auth/env.accessor';
import { getLlm } from '../llm.accessor';
import { PrismaService } from '../../database/prisma.service';

const log = new Logger('AssistantListener');

const TRIAGE_TIMEOUT_MS = 12_000;
/** Anti-coûts : un triage par utilisateur toutes les 10s, hors messages adressés. */
const TRIAGE_USER_COOLDOWN_MS = 10_000;
/** Triage global : seuls les messages assez longs valent un appel cheap. */
const TRIAGE_MIN_LENGTH = 8;

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
 * Triage passif GLOBAL (décision 18/11 : le bot écoute partout) : un modèle
 * cheap décide si le bot doit répondre à un message sans mention.
 * OUI si : adressé au bot ou poursuit un fil où le bot vient de parler,
 * question directe qui s'adresse visiblement à lui, action Discord demandée.
 * NON si : discussion entre humains sans le bot, en cas de doute.
 */
async function shouldReply(message: Message, botUsername: string, inDedicatedChannel: boolean): Promise<boolean> {
  try {
    const recent = [...message.channel.messages.cache.values()]
      .filter((m) => !m.author.bot || m.author.id === botUsername)
      .slice(-8)
      .reverse()
      .map((m) => `[${m.author.username}] : ${(m.content || '(sans texte)').slice(0, 150)}`)
      .join('\n');
    const botParticipated = [...message.channel.messages.cache.values()]
      .slice(-6)
      .some((m) => m.author.id === botUsername);
    const scope = inDedicatedChannel
      ? 'Salon dédié IA : le bot suit TOUTE la conversation et peut répondre à toute question ou demande.'
      : botParticipated
        ? 'Salon normal : le bot a participé aux derniers échanges — il peut répondre aux messages qui poursuivent ce fil.'
        : 'Salon normal : le bot n\u0027a PAS participé récemment. Ne réponds que si le message lui est clairement adressé ou demande explicitement son aide.';
    const completion = await getLlm().chat(
      [
        {
          role: 'system',
          content: [
            'Tu décides si un bot Discord doit répondre à un message. Réponds UNIQUEMENT OUI ou NON.',
            'OUI si : le message s\u0027adresse au bot (question, demande, action Discord à faire), poursuit une conversation que le bot a initiée, apporte une info utile pour la suite, ou est une question directe dans le flux quand le contexte le justifie.',
            'NON si : discussion entre humains qui ne concerne pas le bot, salutation générique sans demande, troll sans contenu, message vide ou réaction.',
            'En cas de doute : NON.',
            `Contexte : ${scope}`,
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
 * - son nom ou un surnom est tapé en texte brut ("10cordes", alias) ;
 * - le message répond directement à un de ses messages ;
 * - SINON, partout : triage passif cheap (OUI/NON avec garde de coûts :
 *   cooldown 10s par utilisateur, longueur minimale) — dans le salon dédié
 *   les règles sont larges, ailleurs elles exigent sa participation récente
 *   ou une adresse claire.
 */
@Listener(Events.MessageCreate)
export class AssistantMentionListener {
  private readonly triageCooldowns = new Map<string, number>();
  private readonly otherBotNamesCache = new Map<string, { names: string[]; fetchedAt: number }>();

  constructor(
    private readonly assistant: AssistantService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Adressé à un AUTRE bot : mention d'un autre bot (sans nous), ou nom
   * d'un autre bot du serveur en tête de message (« JP fais ça »).
   * Les noms des bots du serveur sont mis en cache 5 minutes par guild.
   */
  private async isAddressedToOtherBot(message: Message, meId: string): Promise<boolean> {
    const guild = message.guild;
    if (!guild) return false;
    // Mention explicite d'un autre bot (et pas de nous) → pour lui.
    const otherBotMention = [...message.mentions.users.values()].find(
      (user) => user.bot && user.id !== meId,
    );
    if (otherBotMention) return true;

    const cacheKey = guild.id;
    const cached = this.otherBotNamesCache.get(cacheKey);
    let names: string[];
    if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) {
      names = cached.names;
    } else {
      const members = await guild.members.fetch().catch(() => null);
      // Alias manuels de l'owner (DISCORD_OTHER_BOTS=jp,autrebot) : surnoms
      // qu'aucune heuristique ne peut deviner (ex « JP » pour Jean Pascal).
      const envAliases = getValidatedEnv()
        .DISCORD_OTHER_BOTS.split(',')
        .map((alias) => alias.toLowerCase().trim())
        .filter((alias) => alias.length >= 2);
      const fromMembers = members
        ? [...members.values()]
            .filter((member) => member.user.bot && member.id !== meId)
            .flatMap((member) => {
              const display = (member.displayName ?? member.user.username).toLowerCase().trim();
              const variants = new Set<string>([display, member.user.username.toLowerCase().trim()]);
              // Initiales (Jean Pascal → jp) : le raccourci que les membres tapent.
              const initials = display
                .split(/\s+/u)
                .map((word) => word[0] ?? '')
                .join('')
                .trim();
              if (initials.length >= 2) variants.add(initials);
              return [...variants].filter((variant) => variant.length >= 2);
            })
        : [];
      names = [...fromMembers, ...envAliases];
      this.otherBotNamesCache.set(cacheKey, { names, fetchedAt: Date.now() });
    }
    const head = message.content.trimStart().toLowerCase();
    return names.some(
      (name) =>
        head === name ||
        head.startsWith(`${name} `) ||
        head.startsWith(`${name},`) ||
        head.startsWith(`${name} !`) ||
        head.startsWith(`${name} ?`) ||
        head.startsWith(`${name}.`),
    );
  }

  @On()
  async onMessageCreate(message: Message): Promise<void> {
    // Les webhooks passent (déclencheur d'intégrations) — pas les autres bots.
    if (message.author.bot && !message.webhookId) return;
    const guildId = message.guildId;
    if (!guildId) return;
    const me = message.client.user;
    if (!me) return;

    // Adressé à un AUTRE bot (mention d'un autre bot, ou nom d'un autre bot
    // en tête de message) → c'est pour lui, pas pour nous : silence total,
    // même en salon dédié. Empêche « JP fais ça » d'être traité par nous.
    if (await this.isAddressedToOtherBot(message, me.id)) {
      log.info(`[GATE] adressé à un autre bot → ignoré`);
      return;
    }

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

    // Chaque message VU dans le salon dédié fait avancer le watermark de
    // reprise au boot (aucune demande perdue à un redémarrage).
    if (inDedicatedChannel) {
      void this.prisma.channelWatermark
        .upsert({ where: { channelId: message.channelId }, create: { channelId: message.channelId, lastMessageId: message.id }, update: { lastMessageId: message.id } })
        .catch(() => {});
    }

    if (addressed || repliesToBot) {
      await this.assistant.enqueueMessage(message, repliesToBot);
      return;
    }
    if (message.content.trim().length < TRIAGE_MIN_LENGTH) return;

    // Anti-coûts : un triage passif par utilisateur toutes les 10s.
    const cooldownKey = `${guildId}:${message.author.id}`;
    const lastTriage = this.triageCooldowns.get(cooldownKey);
    if (lastTriage !== undefined && Date.now() - lastTriage < TRIAGE_USER_COOLDOWN_MS) return;
    this.triageCooldowns.set(cooldownKey, Date.now());

    const triageVerdict = await Promise.race([
      shouldReply(message, me.username, inDedicatedChannel),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), TRIAGE_TIMEOUT_MS).unref?.()),
    ]);
    if (!triageVerdict) return;
    log.info(`[GATE] triage passif : réponse déclenchée pour ${message.author.username}`);
    await this.assistant.enqueueMessage(message, repliesToBot);
  }
}
