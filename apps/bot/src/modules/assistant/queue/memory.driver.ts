import type { AgentJobData, QueueCounts } from './types';
import type { QueueDriver } from './queue-driver';

/**
 * Fallback sans Redis : file en mémoire, séquentielle (1 job à la fois).
 * Utilisé uniquement quand REDIS_URL est injoignable (dev sans Docker).
 *
 * À la fermeture (extinction) : plus rien n'est pris, le traitement en cours
 * est attendu, et les demandes en attente sont abandonnées (elles ne vivent
 * que dans cette mémoire).
 */
export class MemoryDriver implements QueueDriver {
  readonly name = 'memory' as const;
  private readonly queue: AgentJobData[] = [];
  private running = false;
  private closing = false;
  private current: Promise<void> | null = null;
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
    if (this.closing) return;
    this.queue.push(job);
    this.pump();
  }

  activeCount(): number {
    return this.running ? 1 : 0;
  }

  async close(): Promise<void> {
    this.closing = true;
    this.queue.length = 0;
    if (this.current) await this.current;
  }

  private pump(): void {
    if (this.running || !this.handler || this.closing) return;
    const handler = this.handler;
    const next = this.queue.shift();
    if (!next) return;
    this.running = true;
    this.current = (async () => {
      try {
        await handler(next);
        this.completed++;
      } catch (error) {
        this.failed++;
        const message = error instanceof Error ? error.message : String(error);
        this.onFailed(next, message);
      } finally {
        this.running = false;
        this.current = null;
        this.pump();
      }
    })();
  }

  async counts(): Promise<QueueCounts> {
    return { waiting: this.queue.length, active: this.running ? 1 : 0, completed: this.completed, failed: this.failed };
  }
}
