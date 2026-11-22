import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import type { Message } from 'discord.js';
import { BullMqDriver } from './queue/bullmq.driver';
import { MemoryDriver } from './queue/memory.driver';
import type { QueueDriver } from './queue/queue-driver';
import { snapshotFromMessage, type AgentJobData, type AgentRequest, type QueueCounts } from './queue/types';
import { AppEnv } from '../../app.env';
import { notice } from '../../shared/ui';

const MAX_PER_USER = 10;
const MAX_QUEUE_TOTAL = 200;

/**
 * Orchestrateur de la queue de l'agent. Persistance + retry délégués au driver
 * (BullMQ + Redis en production, Memory en fallback sans Redis) : un restart
 * n'efface plus les demandes en cours, les échecs sont retraités (3 tentatives,
 * backoff exponentiel). L'ordre FIFO par utilisateur est garanti par la
 * sérialisation du processeur.
 */
@Injectable()
export class AssistantQueue {
  private readonly log = new Logger('AssistantQueue');
  private driver: QueueDriver;
  private processor: ((request: AgentRequest) => Promise<void>) | null = null;
  private currentHandler: ((job: AgentJobData) => Promise<void>) | null = null;
  private readonly perUserPending = new Map<string, number>();

  constructor(private readonly env: AppEnv) {
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

  /** Enregistre le processeur d'une demande (AssistantService) — évite un cycle de DI. */
  setProcessor(processor: (request: AgentRequest) => Promise<void>): void {
    this.processor = processor;
    this.currentHandler = async (job: AgentJobData) => {
      try {
        await this.processor!(job.request);
      } finally {
        const key = `${job.request.guildId}:${job.request.userId}`;
        const remaining = (this.perUserPending.get(key) ?? 1) - 1;
        if (remaining <= 0) this.perUserPending.delete(key);
        else this.perUserPending.set(key, remaining);
      }
    };
    void this.driver.process(this.currentHandler);
  }

  /**
   * Point d'entrée du listener : met la demande en file (FIFO par utilisateur).
   * Retourne false si refusée (caps / queue pleine / agent non prêt) — le
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

    // File silencieuse : la réponse arrive directement (portail éphémère ou salon).
    await this.driver.enqueue({ request: snapshotFromMessage(message, repliesToBot) });
    this.perUserPending.set(key, pendingForUser + 1);
    return true;
  }

  async counts(): Promise<QueueCounts> {
    return this.driver.counts();
  }

  /** 'bullmq' ou 'memory' — exposé par /healthz pour le diagnostic à distance. */
  get driverName(): string {
    return this.driver.name;
  }

  async recentFailures(limit: number): Promise<Array<{ userId: string; content: string; error: string; at: string }>> {
    return this.driver.recentFailures(limit);
  }
}
