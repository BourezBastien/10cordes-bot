import type { AgentJobData, QueueCounts } from './types';

export type QueueDriverName = 'bullmq' | 'memory';

/**
 * Driver de queue : BullMQ en production (persistance Redis, retry, recovery),
 * Memory en fallback (dev sans Redis). Le processeur est sérialisé par
 * utilisateur par l'orchestrateur, pas par le driver.
 */
export interface QueueDriver {
  readonly name: QueueDriverName;
  /** Ajoute un job à la file. */
  enqueue(job: AgentJobData): Promise<void> | void;
  /** Enregistre le processeur d'un job (snapshot). */
  process(handler: (job: AgentJobData) => Promise<void>): Promise<void>;
  /** Compteurs d'état pour l'observabilité. */
  counts(): Promise<QueueCounts>;
  /** Derniers échecs (résumés) pour les tools staff. */
  recentFailures(limit: number): Promise<Array<{ userId: string; content: string; error: string; at: string }>>;
  close(): Promise<void>;
}
