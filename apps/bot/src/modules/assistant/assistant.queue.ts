import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import type { Message } from 'discord.js';
import { BullMqDriver } from './queue/bullmq.driver';
import { MemoryDriver } from './queue/memory.driver';
import type { QueueDriver } from './queue/queue-driver';
import { AGENT_CONCURRENCY, snapshotFromMessage, type AgentRequest, type QueueCounts } from './queue/types';
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
  private readonly driver: QueueDriver;
  private processor: ((request: AgentRequest) => Promise<void>) | null = null;
  private readonly perUserPending = new Map<string, number>();

  constructor(env: AppEnv) {
    // BullMQ si REDIS_URL fourni ; sinon fallback mémoire (dev sans Docker).
    this.driver = env.REDIS_URL
      ? new BullMqDriver(env.REDIS_URL, (job, error) => {
          this.log.warn(`Job échoué (définitif) pour ${job.request.userId} : ${error.slice(0, 120)}`);
        })
      : new MemoryDriver((job, error) => {
          this.log.warn(`Job échoué (définitif) pour ${job.request.userId} : ${error.slice(0, 120)}`);
        });
  }

  /** Enregistre le processeur d'une demande (AssistantService) — évite un cycle de DI. */
  setProcessor(processor: (request: AgentRequest) => Promise<void>): void {
    this.processor = processor;
    this.driver.process(async (job) => {
      try {
        await this.processor!(job.request);
      } finally {
        const key = `${job.request.guildId}:${job.request.userId}`;
        const remaining = (this.perUserPending.get(key) ?? 1) - 1;
        if (remaining <= 0) this.perUserPending.delete(key);
        else this.perUserPending.set(key, remaining);
      }
    });
  }

  /** Point d'entrée du listener : met la demande en file (FIFO par utilisateur). */
  async enqueueMessage(message: Message, repliesToBot: boolean): Promise<void> {
    void repliesToBot;
    const accepted = await this.enqueue(message);
    if (accepted) return;
  }

  /** Met la demande en file (snapshot). Retourne false si refusée (caps). */
  async enqueue(message: Message): Promise<boolean> {
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
    await this.driver.enqueue({ request: snapshotFromMessage(message, false) });
    this.perUserPending.set(key, pendingForUser + 1);
    return true;
  }

  async counts(): Promise<QueueCounts> {
    return this.driver.counts();
  }

  async recentFailures(limit: number): Promise<Array<{ userId: string; content: string; error: string; at: string }>> {
    return this.driver.recentFailures(limit);
  }

  get concurrency(): number {
    return AGENT_CONCURRENCY;
  }
}
