import { z } from 'zod';

// ── Triggers ────────────────────────────────────────────────────────

/** Genre de trigger planifié : à une date (once), par expression cron, ou par intervalle. */
export const ScheduledTriggerKind = z.enum(['once', 'cron', 'interval']);

/** État d'un trigger planifié (armé, terminé, annulé). */
export const TriggerStatus = z.enum(['armed', 'done', 'cancelled']);
