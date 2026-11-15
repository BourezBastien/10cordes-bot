import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import type { Message } from 'discord.js';

interface QueueJob {
  message: Message;
  enqueuedAt: number;
}

const MAX_QUEUE_TOTAL = 50;
const MAX_PER_USER = 3;
const JOB_TTL_MS = 10 * 60_000;
const CONCURRENCY = 3;

/**
 * File d'attente de l'agent : FIFO par utilisateur (l'ordre des demandes d'une
 * même personne est garanti), N workers en parallèle (les appels LLM sont de
 * l'I/O), retour de position, TTL anti-obsolescence.
 */
@Injectable()
export class AssistantQueue {
  private readonly log = new Logger('AssistantQueue');
  private readonly queues = new Map<string, QueueJob[]>();
  private readonly runningKeys = new Set<string>();
  private processor: ((message: Message) => Promise<void>) | null = null;
  private running = 0;

  /** Enregistre le handler de traitement (AssistantService) — évite un cycle de DI. */
  setProcessor(processor: (message: Message) => Promise<void>): void {
    this.processor = processor;
  }

  enqueue(message: Message): void {
    const key = `${message.guildId}:${message.author.id}`;

    if (!this.processor) {
      void message.reply({ content: '⏳ L\'agent démarre, réessaie dans un instant.' }).catch(() => {});
      return;
    }

    let queue = this.queues.get(key);
    if (!queue) {
      queue = [];
      this.queues.set(key, queue);
    }
    if (queue.length >= MAX_PER_USER) {
      void message
        .reply({ content: `⏳ Tu as déjà ${queue.length} demandes en attente : attends les réponses avant d'en rajouter.` })
        .catch(() => {});
      return;
    }
    if (this.totalPending() >= MAX_QUEUE_TOTAL) {
      void message.reply({ content: '⏳ File d\'attente saturée, réessaie dans un instant.' }).catch(() => {});
      return;
    }

    // File silencieuse : aucune annonce de position, le traitement démarre dans l'ordre.
    const job: QueueJob = { message, enqueuedAt: Date.now() };
    queue.push(job);
    this.pump();
  }

  private totalPending(): number {
    let total = 0;
    for (const queue of this.queues.values()) total += queue.length;
    return total;
  }

  private pump(): void {
    while (this.running < CONCURRENCY) {
      const next = this.takeNext();
      if (!next) break;
      this.running++;
      const { key, job } = next;
      void this.run(key, job);
    }
  }

  private takeNext(): { key: string; job: QueueJob } | null {
    for (const [key, queue] of [...this.queues.entries()]) {
      if (this.runningKeys.has(key)) continue;
      while (queue.length > 0) {
        const job = queue.shift()!;
        if (Date.now() - job.enqueuedAt > JOB_TTL_MS) continue;
        return { key, job };
      }
    }
    return null;
  }

  private async run(key: string, job: QueueJob): Promise<void> {
    this.runningKeys.add(key);
    try {
      await this.processor?.(job.message);
    } catch (error) {
      this.log.error(`Job failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.runningKeys.delete(key);
      this.running--;
      this.pump();
    }
  }
}
