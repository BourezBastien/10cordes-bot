import type { AgentJobData, QueueCounts } from './types';
import type { QueueDriver } from './queue-driver';

interface MemoryEntry {
  job: AgentJobData;
  handler: (job: AgentJobData) => Promise<void>;
}

/**
 * Fallback sans Redis : file en mémoire, séquentielle (1 job à la fois).
 * Utilisé uniquement quand REDIS_URL est injoignable (dev sans Docker).
 */
export class MemoryDriver implements QueueDriver {
  readonly name = 'memory' as const;
  private readonly queue: MemoryEntry[] = [];
  private running = false;
  private handler: ((job: AgentJobData) => Promise<void>) | null = null;
  private completed = 0;
  private failed = 0;
  private readonly recent: Array<{ userId: string; content: string; error: string; at: string }> = [];

  constructor(private readonly onFailed: (job: AgentJobData, error: string) => void) {}

  async process(handler: (job: AgentJobData) => Promise<void>): Promise<void> {
    this.handler = handler;
    this.pump();
  }

  enqueue(job: AgentJobData): void {
    this.queue.push({ job, handler: this.handler! });
    this.pump();
  }

  private pump(): void {
    if (this.running) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running = true;
    void (async () => {
      try {
        await next.handler(next.job);
        this.completed++;
      } catch (error) {
        this.failed++;
        const message = error instanceof Error ? error.message : String(error);
        this.onFailed(next.job, message);
        this.recent.unshift({
          userId: next.job.request.userId,
          content: next.job.request.content.slice(0, 80),
          error: message,
          at: new Date().toISOString(),
        });
        if (this.recent.length > 20) this.recent.pop();
      } finally {
        this.running = false;
        this.pump();
      }
    })();
  }

  async counts(): Promise<QueueCounts> {
    return { waiting: this.queue.length, active: this.running ? 1 : 0, completed: this.completed, failed: this.failed };
  }

  async recentFailures(limit: number): Promise<Array<{ userId: string; content: string; error: string; at: string }>> {
    return this.recent.slice(0, limit);
  }

  async close(): Promise<void> {}
}
