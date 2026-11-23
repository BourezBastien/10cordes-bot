import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { ChannelType, Client, PermissionFlagsBits, type Guild, type Message, type TextChannel } from 'discord.js';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { botPermissionPolicy } from '../../core/security/bot-permission.policy';
import { getLlm } from '../assistant/llm.accessor';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { fileLog } from '../logging/file-log.service';
import { distillBatch, persistsObservations } from './guild-history-ingestion.distiller';
import { buildIngestionTools } from './guild-history-ingestion.tools';

/**
 * Ingestion de l'historique d'un serveur (B1) : au premier join (ou sur
 * demande admin), le bot lit les derniers messages des salons lisibles et
 * distille culture/ton/vocabulaire/rôle des salons/règles implicites vers
 * GuildMemoryProfile + GuildMemory. L'agent démarre ainsi avec le contexte
 * du serveur au lieu d'une mémoire vide.
 *
 * Garde-fous :
 * - NON-BLOQUANT : le GuildCreate listener rend la main immédiatement,
 *   l'ingestion tourne en tâche de fond (une par serveur max) ;
 * - RESUMABLE : curseur IngestionCursor par salon (lastMessageId) ; un crash
 *   au milieu reprend où il s'était arrêté (sweep au boot) ;
 * - PRIVACY : messages des bots/webhooks ignorés, opt-out mémoire respecté,
 *   contenu tronqué à 300 caractères et jamais retransmis tel quel ;
 * - BUDGET : plafonds durs par ingestion (salons, messages/salon, appels LLM) ;
 *   rate-limit Discord respecté (délai entre pages + backoff 429).
 */

const MAX_CHANNELS = 40;
const MAX_MESSAGES_PER_CHANNEL = 600;
const MESSAGES_PER_LLM_BATCH = 200;
const MAX_LLM_CALLS = 20;
const FETCH_DELAY_MS = 600;
const MESSAGE_SNIPPET_CHARS = 300;
const PROFILE_BUDGET = 2000;
/** Join « frais » =GuildCreate réel ; au-delà = replay de login, ignoré. */
export const FRESH_JOIN_WINDOW_MS = 5 * 60_000;

export type IngestionTriggerResult =
  | { status: 'started' }
  | { status: 'already-running' }
  | { status: 'llm-missing' }
  | { status: 'nothing-to-do'; reason: string };

@Injectable()
export class GuildHistoryIngestionService implements SpraxiumOnBoot {
  private readonly log = new Logger('HistoryIngestion');
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly client: Client,
  ) {}

  onBoot(): void {
    for (const tool of buildIngestionTools(this)) getToolRegistry().register(tool);
    void this.resumeInterrupted();
  }

  /**
   * Point d'entrée (listener GuildCreate ou tool admin). Idempotent :
   * refuse de relancer si déjà en cours, ou si le serveur a déjà été
   * ingéré (sauf force).
   */
  async trigger(guildId: string, options: { force?: boolean; actorId?: string } = {}): Promise<IngestionTriggerResult> {
    if (this.running.has(guildId)) return { status: 'already-running' };
    if (!getLlm().configured) return { status: 'llm-missing' };
    if (!options.force) {
      const [profile, cursors] = await Promise.all([
        this.prisma.guildMemoryProfile.findUnique({ where: { guildId }, select: { text: true } }),
        this.prisma.ingestionCursor.count({ where: { guildId } }),
      ]);
      if ((profile?.text ?? '').length > 0 || cursors > 0) {
        return { status: 'nothing-to-do', reason: 'historique déjà ingéré (utilise force pour relancer)' };
      }
    }
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return { status: 'nothing-to-do', reason: 'serveur introuvable (pas dans le cache)' };

    this.running.add(guildId);
    void this.runIngestion(guild, options.actorId ?? guild.ownerId, options.force === true)
      .catch((error) => this.log.warn(`Ingestion ${guildId} échouée : ${(error as Error).message.slice(0, 160)}`))
      .finally(() => this.running.delete(guildId));
    return { status: 'started' };
  }

  /** Statut courant : salons restants (running) ou résultat final. */
  async status(guildId: string): Promise<{ running: boolean; done: number; total: number; errors: number }> {
    const cursors = await this.prisma.ingestionCursor.findMany({
      where: { guildId },
      select: { status: true },
    });
    return {
      running: this.running.has(guildId),
      done: cursors.filter((cursor) => cursor.status === 'done').length,
      total: cursors.length,
      errors: cursors.filter((cursor) => cursor.status === 'error').length,
    };
  }

  /** Reprise après crash/restart : chaque serveur avec curseurs running repart. */
  private async resumeInterrupted(): Promise<void> {
    const interrupted = await this.prisma.ingestionCursor
      .groupBy({ by: ['guildId'], where: { status: 'running' } })
      .catch(() => [] as Array<{ guildId: string }>);
    for (const row of interrupted) {
      const result = await this.trigger(row.guildId, { force: true }).catch(() => null);
      if (result?.status === 'started') this.log.info(`Reprise d'ingestion interrompue : ${row.guildId}.`);
    }
  }

  // ── Pipeline ──────────────────────────────────────────────────────────

  private async runIngestion(guild: Guild, actorId: string, force: boolean): Promise<void> {
    const channels = guild.channels.cache
      .filter((channel): channel is TextChannel => {
        if (channel.type !== ChannelType.GuildText) return false;
        // Le bot ne lit que les salons où il a le droit de lire l'historique.
        return botPermissionPolicy.canAllInChannel(channel, ['ViewChannel', 'ReadMessageHistory']);
      })
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((channel) => ({ id: channel.id, name: channel.name, channel }))
      .slice(0, MAX_CHANNELS);

    if (force) {
      await this.prisma.ingestionCursor.deleteMany({ where: { guildId: guild.id } }).catch(() => {});
    }

    const optOuts = new Set(
      (await this.prisma.memoryOptOut.findMany({ where: { guildId: guild.id }, select: { userId: true } })).map((row) => row.userId),
    );

    let llmCalls = 0;
    let totalMessages = 0;
    let totalObservations = 0;

    fileLog()?.event('info', 'ingestion', 'start', { guildId: guild.id, channels: channels.length, force });

    for (const { id: channelId, name: channelName, channel } of channels) {
      const cursor = await this.prisma.ingestionCursor.upsert({
        where: { guildId_channelId: { guildId: guild.id, channelId } },
        create: { guildId: guild.id, channelId, channelName, status: 'running' },
        update: { status: 'running', errorMessage: null },
      });

      try {
        const { messages, lastMessageId } = await this.fetchChannelMessages(channel, cursor.lastMessageId, optOuts);
        totalMessages += messages.length;

        for (let offset = 0; offset < messages.length; offset += MESSAGES_PER_LLM_BATCH) {
          if (llmCalls >= MAX_LLM_CALLS) break;
          const batch = messages.slice(offset, offset + MESSAGES_PER_LLM_BATCH);
          const observations = await distillBatch(channelName, batch, actorId);
          llmCalls += 1;
          if (observations.length > 0) {
            totalObservations += observations.length;
            await persistsObservations(this.prisma, guild.id, observations);
          }
        }

        await this.prisma.ingestionCursor.update({
          where: { id: cursor.id },
          data: { status: 'done', lastMessageId: lastMessageId ?? null },
        });
        if (llmCalls >= MAX_LLM_CALLS) break;
      } catch (error) {
        await this.prisma.ingestionCursor
          .update({
            where: { id: cursor.id },
            data: { status: 'error', errorMessage: (error as Error).message.slice(0, 200) },
          })
          .catch(() => {});
        fileLog()?.event('warn', 'ingestion', 'channel_error', { guildId: guild.id, channelId, error: (error as Error).message.slice(0, 180) });
        // Quota épuisé : inutile de brûler les salons suivants (même échec).
        if (error instanceof Error && error.message.includes('crédits IA épuisés')) {
          this.log.warn(`Ingestion ${guild.id} interrompue : crédits IA épuisés (reprise au prochain boot).`);
          break;
        }
      }
    }

    this.audit.record({
      guildId: guild.id,
      source: 'system',
      action: 'memory.ingestion.completed',
      actorId,
      metadata: { channels: channels.length, messages: totalMessages, observations: totalObservations, llmCalls },
    });
    fileLog()?.event('info', 'ingestion', 'completed', {
      guildId: guild.id,
      channels: channels.length,
      messages: totalMessages,
      observations: totalObservations,
    });
    this.log.info(`Ingestion ${guild.name} terminée : ${totalObservations} observations depuis ${totalMessages} messages.`);
  }

  /** Pagination arrière (100/page, délai + backoff 429) avec filtres privacy. */
  private async fetchChannelMessages(
    channel: TextChannel,
    resumeFrom: string | null,
    optOuts: Set<string>,
  ): Promise<{ messages: string[]; lastMessageId: string | null }> {
    const messages: string[] = [];
    let before: string | undefined = resumeFrom ?? undefined;
    // Curseur = le plus ANCIEN message déjà lu (reprise vers le passé).
    let lastMessageId: string | null = resumeFrom;

    while (messages.length < MAX_MESSAGES_PER_CHANNEL) {
      const page = await this.fetchWithBackoff(channel, before);
      if (page.size === 0) break;
      for (const message of page.values()) {
        const content = this.snippet(message, optOuts);
        if (content) messages.push(content);
      }
      const oldest = page.last()?.id;
      if (oldest) {
        lastMessageId = oldest;
        before = oldest;
      }
      if (page.size < 100) break;
      await delay(FETCH_DELAY_MS);
    }
    return { messages, lastMessageId };
  }

  private async fetchWithBackoff(
    channel: TextChannel,
    before?: string,
  ): Promise<import('discord.js').Collection<string, Message<true>>> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      } catch (error) {
        const retryAfter = (error as { retryAfter?: number }).retryAfter;
        if (attempt < 3 && retryAfter !== undefined) {
          await delay((retryAfter + 1) * 1000);
          continue;
        }
        throw error;
      }
    }
  }

  /** Filtre privacy : bots, webhooks, opt-out, vide — puis troncature. */
  private snippet(message: Message, optOuts: Set<string>): string | null {
    if (message.author.bot) return null;
    if (message.webhookId !== null && message.webhookId !== undefined) return null;
    if (optOuts.has(message.author.id)) return null;
    const content = message.content.trim();
    if (content.length === 0) return null;
    return `[${message.author.username}] ${content.slice(0, MESSAGE_SNIPPET_CHARS)}`;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
