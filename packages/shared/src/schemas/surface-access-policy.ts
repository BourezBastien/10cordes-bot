import { z } from 'zod';
import { ConditionSpecSchema } from './surface-condition.js';

// ── AccessPolicy ────────────────────────────────────────────────────

/** Politique d'accès d'un binding : qui peut cliquer, à quelle fréquence, sous quelle condition. */
export const AccessPolicySchema = z.object({
  /** Permissions Discord exigées du membre qui interagit (toutes). */
  permissions: z.array(z.string().min(3).max(40)).max(10).optional(),
  /** Un de ces rôles suffit. */
  roleIds: z.array(z.string().min(15)).max(10).optional(),
  /** Allowlist explicite de membres. */
  userIds: z.array(z.string().min(15)).max(50).optional(),
  /** Cooldown PAR UTILISATEUR (ICacheStore), indépendant du binding. */
  cooldownPerUserSec: z.number().int().min(1).max(86_400 * 30).optional(),
  /** Condition arbitraire évaluée au clic (state-driven : tours, soldes...). */
  condition: ConditionSpecSchema.optional(),
  /** Refus éphémère lisible (interpolé) ; défaut sobre. */
  denyMessage: z.string().max(300).optional(),
});
export type AccessPolicy = z.infer<typeof AccessPolicySchema>;
