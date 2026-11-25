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
  /** Demandes en traitement, tout de suite. */
  activeCount(): number;
  /**
   * Extinction : plus aucun job n'est pris ; ceux en traitement finissent et
   * sont attendus (sans délai propre : l'appelant en met un). BullMQ garde en
   * Redis les jobs en attente, pour le démarrage suivant ; la mémoire les perd.
   */
  close(): Promise<void>;
}
