import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { AGENT_CONCURRENCY, JOB_ATTEMPTS, QUEUE_NAME, type AgentJobData, type QueueCounts } from './types';
import type { QueueDriver } from './queue-driver';


export class BullMqDriver implements QueueDriver {
  readonly name = 'bullmq' as const;
  private readonly connection: Redis;
  private readonly queue: Queue<AgentJobData>;
  private worker: Worker<AgentJobData> | null = null;
  private readonly recent: Array<{ userId: string; content: string; error: string; at: string }> = [];

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

  async process(handler: (job: AgentJobData) => Promise<void>): Promise<void> {
    this.worker = new Worker<AgentJobData>(
      QUEUE_NAME,
      async (job) => {
        await handler(job.data);
      },
      {
        connection: this.connection,
        concurrency: AGENT_CONCURRENCY,
      },
    );
    this.worker.on('failed', (job, error) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        const data = job.data;
        this.onFailure(data, error.message);
        this.recent.unshift({
          userId: data.request.userId,
          content: data.request.content.slice(0, 80),
          error: error.message.slice(0, 160),
          at: new Date().toISOString(),
        });
        if (this.recent.length > 20) this.recent.pop();
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

  async recentFailures(limit: number): Promise<Array<{ userId: string; content: string; error: string; at: string }>> {
    return this.recent.slice(0, limit);
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
