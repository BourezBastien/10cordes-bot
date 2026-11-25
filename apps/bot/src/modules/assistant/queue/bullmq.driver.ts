import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { AGENT_CONCURRENCY, JOB_ATTEMPTS, QUEUE_NAME, type AgentJobData, type QueueCounts } from './types';
import type { QueueDriver } from './queue-driver';


export class BullMqDriver implements QueueDriver {
  readonly name = 'bullmq' as const;
  private readonly connection: Redis;
  private readonly queue: Queue<AgentJobData>;
  private worker: Worker<AgentJobData> | null = null;
  /** Demandes en traitement par CE processus (BullMQ compte aussi celles des autres workers). */
  private active = 0;

  constructor(
    redisUrl: string,
    private readonly onFailure: (job: AgentJobData, error: string) => void,
  ) {
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<AgentJobData>(QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      },
    });
  }

  async enqueue(job: AgentJobData): Promise<void> {
    await this.queue.add('agent-request', job);
  }

  activeCount(): number {
    return this.active;
  }

  async process(handler: (job: AgentJobData) => Promise<void>): Promise<void> {
    this.worker = new Worker<AgentJobData>(
      QUEUE_NAME,
      async (job) => {
        this.active += 1;
        try {
          await handler(job.data);
        } finally {
          this.active -= 1;
        }
      },
      {
        connection: this.connection,
        concurrency: AGENT_CONCURRENCY,
      },
    );
    this.worker.on('failed', (job, error) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        this.onFailure(job.data, error.message);
      }
    });
    await this.worker.waitUntilReady();
  }

  async counts(): Promise<QueueCounts> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed');
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
    };
  }

  /**
   * Extinction, dans l'ordre que recommande BullMQ : le worker d'abord (il
   * attend, sans délai propre, les traitements en cours ; l'appelant en met
   * un), la file ensuite, la connexion enfin. Les demandes en attente restent
   * dans Redis, pour le démarrage suivant.
   */
  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
