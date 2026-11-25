import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import type { Message } from 'discord.js';
import { BullMqDriver } from './queue/bullmq.driver';
import { MemoryDriver } from './queue/memory.driver';
import type { QueueDriver } from './queue/queue-driver';
import { snapshotFromMessage, type AgentJobData, type AgentRequest, type QueueCounts } from './queue/types';
import { AppEnv } from '../../app.env';
import { notice } from '../../shared/ui';
import { TypingIndicator } from './typing-indicator';

const MAX_PER_USER = 10;
const MAX_QUEUE_TOTAL = 200;

/** Une demande, pour l'indicateur « écrit… » qu'elle a ouvert à son acceptation. */
const typingKeyOf = (request: AgentRequest): string => `${request.channelId}:${request.messageId}`;

/**
 * Orchestrateur de la queue de l'agent. Persistance + retry délégués au driver
 * (BullMQ + Redis en production, Memory en fallback sans Redis) : un restart
 * n'efface plus les demandes en cours, les échecs sont retraités (3 tentatives,
 * backoff exponentiel). L'ordre FIFO par utilisateur est garanti par la
 * sérialisation du processeur.
 *
 * Une demande acceptée affiche « écrit… » dans son salon jusqu'à ce qu'elle
 * soit soldée : l'attente en file est comprise.
 */
@Injectable()
export class AssistantQueue {
  private readonly log = new Logger('AssistantQueue');
  private driver: QueueDriver;
  private processor: ((request: AgentRequest) => Promise<void>) | null = null;
  private currentHandler: ((job: AgentJobData) => Promise<void>) | null = null;
  private readonly perUserPending = new Map<string, number>();
  /** Relâche de l'indicateur de chaque demande en file ou en cours. */
  private readonly typingReleases = new Map<string, () => void>();
  /** Vrai dès que l'extinction a commencé. */
  private closing = false;

  constructor(
    private readonly env: AppEnv,
    private readonly typing: TypingIndicator,
  ) {
    // BullMQ si REDIS_URL fourni ; sinon fallback mémoire (dev sans Docker).
    this.driver = this.env.REDIS_URL ? new BullMqDriver(this.env.REDIS_URL, (job, error) => this.onFinalFailure(job, error)) : this.memoryDriver();
    // Sonde de connexion : Redis injoignable sous 5s -> bascule mémoire
    // (le bot reste fonctionnel même sans Docker). Le handler ENREGISTRÉ est
    // re-passé au nouveau driver : sans ça, la bascule après setProcessor
    // laissait le MemoryDriver sans handler (jobs perdus).
    void Promise.race([
      this.driver.counts(),
      new Promise((resolve) => setTimeout(resolve, 5_000).unref?.()),
    ]).then((ok) => {
      if (!ok) {
        this.log.warn('Redis injoignable : bascule de la queue en mémoire.');
        this.driver = this.memoryDriver();
        if (this.currentHandler) void this.driver.process(this.currentHandler);
      }
    });
  }

  private memoryDriver(): MemoryDriver {
    return new MemoryDriver((job, error) => this.onFinalFailure(job, error));
  }

  private onFinalFailure(job: AgentJobData, error: string): void {
    this.log.warn(`Job échoué (définitif) pour ${job.request.userId} : ${error.slice(0, 120)}`);
  }

  /** Enregistre le processeur d'une demande (AssistantService), sans cycle de DI. */
  setProcessor(processor: (request: AgentRequest) => Promise<void>): void {
    this.processor = processor;
    this.currentHandler = async (job: AgentJobData) => {
      // Lu AVANT le traitement : le coalescing réécrit le message d'une demande en cours.
      const typingKey = typingKeyOf(job.request);
      try {
        await this.processor!(job.request);
      } finally {
        const key = `${job.request.guildId}:${job.request.userId}`;
        const remaining = (this.perUserPending.get(key) ?? 1) - 1;
        if (remaining <= 0) this.perUserPending.delete(key);
        else this.perUserPending.set(key, remaining);
        // Soldée, réussie ou non : l'indicateur de la demande s'éteint.
        this.typingReleases.get(typingKey)?.();
        this.typingReleases.delete(typingKey);
      }
    };
    void this.driver.process(this.currentHandler);
  }

  /**
   * Point d'entrée du listener : met la demande en file (FIFO par utilisateur).
   * Retourne false si refusée (caps / queue pleine / agent non prêt) : le
   * caller (boot-recovery) n'avance son watermark QUE sur true.
   */
  async enqueueMessage(message: Message, repliesToBot: boolean): Promise<boolean> {
    return this.enqueue(message, repliesToBot);
  }

  /** Met la demande en file (snapshot). Retourne false si refusée (caps). */
  async enqueue(message: Message, repliesToBot = false): Promise<boolean> {
    const key = `${message.guildId}:${message.author.id}`;

    if (!this.processor) {
      void message.reply(notice("L'agent démarre, réessaie dans un instant.", true)).catch(() => {});
      return false;
    }

    // Extinction en cours : la demande serait perdue (mémoire) ou attendre le redémarrage sans prévenir.
    if (this.closing) {
      void message.reply(notice('Le bot redémarre, réessaie dans un instant.', true)).catch(() => {});
      return false;
    }

    const pendingForUser = this.perUserPending.get(key) ?? 0;
    if (pendingForUser >= MAX_PER_USER) {
      void message
        .reply(notice(`Tu as déjà ${pendingForUser} demandes en attente : attends les réponses avant d'en rajouter.`, true))
        .catch(() => {});
      return false;
    }

    const counts = await this.driver.counts();
    if (counts.waiting + counts.active >= MAX_QUEUE_TOTAL) {
      void message.reply(notice('File d\u2019attente saturée, réessaie dans un instant.', true)).catch(() => {});
      return false;
    }

    // File silencieuse : rien ne s'affiche avant la réponse finale, sauf « écrit… »,
    // ouvert ici (l'acceptation) pour couvrir l'attente en file.
    const request = snapshotFromMessage(message, repliesToBot);
    const typingKey = typingKeyOf(request);
    this.typingReleases.get(typingKey)?.();
    const releaseTyping = this.typing.hold(message.channelId, {
      // Seul un salon textuel sait afficher l'indicateur (la gate n'accepte que des messages de serveur).
      sendTyping: () => ('sendTyping' in message.channel ? message.channel.sendTyping() : Promise.resolve()),
    });
    this.typingReleases.set(typingKey, releaseTyping);
    try {
      await this.driver.enqueue({ request });
    } catch (error) {
      releaseTyping();
      this.typingReleases.delete(typingKey);
      throw error;
    }
    this.perUserPending.set(key, pendingForUser + 1);
    return true;
  }

  async counts(): Promise<QueueCounts> {
    return this.driver.counts();
  }

  /** Demandes en traitement par ce processus, tout de suite. */
  activeCount(): number {
    return this.driver.activeCount();
  }

  /** L'extinction a commencé : plus aucune demande n'est acceptée. */
  isClosing(): boolean {
    return this.closing;
  }

  /**
   * Extinction : plus aucune demande n'est prise ni acceptée ; les indicateurs
   * « écrit… » des demandes en attente s'éteignent, et celles en traitement
   * finissent (le pilote les attend). Les demandes en attente restent au
   * pilote : BullMQ les garde pour le démarrage suivant, la mémoire les perd.
   */
  close(): Promise<void> {
    this.closing = true;
    for (const release of this.typingReleases.values()) release();
    this.typingReleases.clear();
    return this.driver.close();
  }

  /** Nom du driver ('bullmq' ou 'memory'), exposé par /healthz pour le diagnostic à distance. */
  get driverName(): string {
    return this.driver.name;
  }
}
