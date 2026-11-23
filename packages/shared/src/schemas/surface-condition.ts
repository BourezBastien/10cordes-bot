import { z } from 'zod';
import { Macro } from './surface-macro.js';

// ── Conditions (Specification Pattern) ─────────────────────────────

const stateOps = z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'exists', 'contains']);

/** Union manuelle (pattern Zod recursive : TS ne peut pas inférer les types
 * récursifs — on déclare, le schéma reste la validation runtime). */
export type StateOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'contains';

export type ConditionSpec =
  | { kind: 'state'; path: string; op: StateOp; value?: string | number | boolean | null }
  | { kind: 'records.count'; collection: string; filterDataContains?: string; createdBy?: string; op: 'gte' | 'lte' | 'eq'; value: number }
  | { kind: 'voice.inChannel'; userId: string; channelId?: string }
  | { kind: 'member.hasRole'; userId: string; roleId: string }
  | { kind: 'member.accountAgeDays'; userId: string; op: 'gte' | 'lte'; value: number }
  | { kind: 'member.joinedDays'; userId: string; op: 'gte' | 'lte'; value: number }
  | { kind: 'regex'; input: string; pattern: string }
  | { kind: 'slidingWindow'; key: string; threshold: number; windowSec: number }
  | { kind: 'all'; conditions: ConditionSpec[] }
  | { kind: 'any'; conditions: ConditionSpec[] }
  | { kind: 'not'; condition: ConditionSpec };

/** Schéma récursif (Zod 4 : lazy + union manuelle) : tout se trouve dans CE
 * fichier, les combinateurs all/any/not se référencent eux-mêmes. */
export const ConditionSpecSchema: z.ZodType<ConditionSpec> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    /** Comparaison sur l'état de la surface (ou variable interpolée). */
    z.object({
      kind: z.literal('state'),
      path: Macro,
      op: stateOps,
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    }),
    /** Comptage de records d'une collection (query typée). */
    z.object({
      kind: z.literal('records.count'),
      collection: z.string().min(1).max(40),
      filterDataContains: z.string().max(120).optional(),
      createdBy: Macro.optional(),
      op: z.enum(['gte', 'lte', 'eq']),
      value: z.number().int().min(0),
    }),
    /** Le membre est-il en vocal (channelId optionnel = n'importe quel vocal). */
    z.object({ kind: z.literal('voice.inChannel'), userId: Macro, channelId: Macro.optional() }),
    /** Le membre porte-t-il ce rôle. */
    z.object({ kind: z.literal('member.hasRole'), userId: Macro, roleId: z.string().min(15) }),
    /** Ancienneté du compte Discord du membre (jours). */
    z.object({ kind: z.literal('member.accountAgeDays'), userId: Macro, op: z.enum(['gte', 'lte']), value: z.number().int().min(0) }),
    /** Ancienneté d'adhésion au serveur (jours). */
    z.object({ kind: z.literal('member.joinedDays'), userId: Macro, op: z.enum(['gte', 'lte']), value: z.number().int().min(0) }),
    /** Regex sur une valeur interpolée (contenu, state...). */
    z.object({ kind: z.literal('regex'), input: Macro, pattern: z.string().min(1).max(200) }),
    /** Fenêtre glissante ICacheStore : nb d'événements dans windowSec. */
    z.object({
      kind: z.literal('slidingWindow'),
      key: Macro,
      threshold: z.number().int().min(1),
      windowSec: z.number().int().min(1).max(86_400 * 30),
    }),
    /** Combinateurs. */
    z.object({ kind: z.literal('all'), conditions: z.array(ConditionSpecSchema).min(1).max(8) }),
    z.object({ kind: z.literal('any'), conditions: z.array(ConditionSpecSchema).min(1).max(8) }),
    z.object({ kind: z.literal('not'), condition: ConditionSpecSchema }),
  ]),
);
