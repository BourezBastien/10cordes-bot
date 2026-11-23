import type { AgentJobData, QueueCounts } from './types';
import type { QueueDriver } from './queue-driver';

/**
 * Fallback sans Redis : file en mémoire, séquentielle (1 job à la fois).
 * Utilisé uniquement quand REDIS_URL est injoignable (dev sans Docker).
 */
export class MemoryDriver implements QueueDriver {
  readonly name = 'memory' as const;
  private readonly queue: AgentJobData[] = [];
  private running = false;
  private handler: ((job: AgentJobData) => Promise<void>) | null = null;
  private completed = 0;
  private failed = 0;

  constructor(private readonly onFailed: (job: AgentJobData, error: string) => void) {}

  async process(handler: (job: AgentJobData) => Promise<void>): Promise<void> {
    this.handler = handler;
    // Draine aussi les jobs mis en file AVANT l'enregistrement du handler
    // (bascule bullmq -> memory en cours de route).
    this.pump();
  }

  enqueue(job: AgentJobData): void {
    this.queue.push(job);
    this.pump();
  }

  private pump(): void {
    if (this.running || !this.handler) return;
    const handler = this.handler;
    const next = this.queue.shift();
    if (!next) return;
    this.running = true;
    void (async () => {
      try {
        await handler(next);
        this.completed++;
      } catch (error) {
        this.failed++;
        const message = error instanceof Error ? error.message : String(error);
        this.onFailed(next, message);
      } finally {
        this.running = false;
        this.pump();
      }
    })();
  }

  async counts(): Promise<QueueCounts> {
    return { waiting: this.queue.length, active: this.running ? 1 : 0, completed: this.completed, failed: this.failed };
  }

  async close(): Promise<void> {}
}
