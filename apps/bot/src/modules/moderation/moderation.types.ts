/** Action de modération tracée dans une case (et préfixe d'audit `mod.<action>`). */
export type ModAction =
  | 'warn'
  | 'timeout'
  | 'untimeout'
  | 'kick'
  | 'ban'
  | 'unban'
  | 'derank'
  | 'purge';

/** Une case de modération (table ModCase), telle que l'agent et les tools la lisent. */
export interface CaseEntry {
  caseId: number;
  userId: string;
  moderatorId: string;
  action: ModAction | string;
  reason?: string | null;
  durationMs?: number | null;
  createdAt: Date;
}

/** Durée maximale d'un timeout Discord : 28 jours. */
export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1_000;
