import { z } from 'zod';
import { Macro } from './surface-macro.js';
import { ConditionSpecSchema, type ConditionSpec } from './surface-condition.js';
import { ModalSpecSchema, type ModalSpec } from './surface-modal.js';

// ── ActionPipeline (Command + Composite) ────────────────────────────

/** Union manuelle (récursivité via if/forEach/trigger.schedule imbriqués). */
export type PipelineStep =
  | { type: 'runTool'; name: string; input: Record<string, unknown> }
  | { type: 'setState'; path: string; value?: string | number | boolean | null | Record<string, unknown> | unknown[]; mode: 'set' | 'increment' | 'decrement' | 'toggle' }
  | { type: 'updateComponent'; binding: string; patch: { label?: string; style?: 'primary' | 'secondary' | 'success' | 'danger'; emoji?: string; disabled?: boolean } }
  | { type: 'sendMessage'; channelId?: string; content: string }
  | { type: 'replyEphemeral'; content: string }
  | { type: 'openModal'; modal: ModalSpec }
  | { type: 'record.write'; collection: string; data: Record<string, unknown> }
  | { type: 'trigger.schedule'; key?: string; delaySec?: number; cron?: string; condition?: ConditionSpec; steps: PipelineStep[] }
  | { type: 'trigger.cancelByKey'; key: string }
  | { type: 'random'; min: number; max: number }
  | { type: 'llm'; prompt: string; maxChars: number; saveTo?: string; parseJson?: boolean }
  | { type: 'if'; condition: ConditionSpec; then: PipelineStep[]; else?: PipelineStep[] }
  | { type: 'forEach'; over: 'roleMembers' | 'records'; roleId?: string; collection?: string; limit: number; as: 'member' | 'record'; steps: PipelineStep[] }
  | { type: 'claimOnce'; key: string; ttlSec: number; winnerVar: string };

/** Étapes d'un pipeline : schéma récursif (Zod 4 : lazy + union manuelle),
 * les étapes imbriquées (if/forEach/trigger.schedule) se référencent ici. */
export const PipelineStepSchema: z.ZodType<PipelineStep> = z.lazy(() =>
  z.discriminatedUnion('type', [
    /** Exécute un tool du registry (typé RegisteredToolName côté consommateur). */
    z.object({
      type: z.literal('runTool'),
      name: z.string().min(3).max(60),
      input: z.record(z.string(), z.unknown()).default({}),
    }),
    /** Mutation de l'état de la surface. `value` accepte tout JSON (une référence
     * "{{steps.N.value}}" ou "{{state.x}}" garde le type de sa cible à l'exécution). */
    z.object({
      type: z.literal('setState'),
      path: z.string().min(1).max(80),
      value: z
        .union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.record(z.string(), z.unknown()), z.array(z.unknown()).max(50)])
        .optional(),
      mode: z.enum(['set', 'increment', 'decrement', 'toggle']).default('set'),
    }),
    /** Patch d'un composant (label/style/emoji/disabled) + re-render auto. */
    z.object({
      type: z.literal('updateComponent'),
      binding: z.string().min(1).max(60),
      patch: z.object({
        label: z.string().max(80).optional(),
        style: z.enum(['primary', 'secondary', 'success', 'danger']).optional(),
        emoji: z.string().max(16).optional(),
        disabled: z.boolean().optional(),
      }),
    }),
    /** Message salon (interpolé). */
    z.object({ type: z.literal('sendMessage'), channelId: Macro.optional(), content: z.string().min(1).max(1900) }),
    /** Réponse éphémère au membre qui interagit (interpolée). */
    z.object({ type: z.literal('replyEphemeral'), content: z.string().min(1).max(1000) }),
    /** Ouvre un modal (DOIT être la 1re étape — règle des 3 s API v10). */
    z.object({ type: z.literal('openModal'), modal: ModalSpecSchema }),
    /** Écrit un record typé (userId de l'acteur injecté). */
    z.object({ type: z.literal('record.write'), collection: z.string().min(1).max(40), data: z.record(z.string(), z.unknown()) }),
    /** Planifie un trigger (délai/cron) — exécuté par la queue durable. */
    z.object({
      type: z.literal('trigger.schedule'),
      key: z.string().min(1).max(80).optional().describe('Clé d\u0027annulation (cancelByKey)'),
      delaySec: z.number().int().min(1).max(86_400 * 90).optional(),
      cron: z.string().min(5).max(60).optional(),
      condition: ConditionSpecSchema.optional().describe('Exécuté seulement si la spec passe à l\u0027échéance'),
      steps: z.array(PipelineStepSchema).min(1).max(10),
    }),
    /** Annule un trigger planifié par sa clé (ex : suppression vocal annulée). */
    z.object({ type: z.literal('trigger.cancelByKey'), key: z.string().min(1).max(80) }),
    /** Aléatoire borné → variable steps.N.value. */
    z.object({ type: z.literal('random'), min: z.number().int(), max: z.number().int() }),
    /** LLM : prompt interpolé → steps.N.text (résumés, reformulations), rangé dans l'état si saveTo (JSON si parseJson). */
    z.object({
      type: z.literal('llm'),
      prompt: z.string().min(3).max(1200),
      maxChars: z.number().int().min(20).max(1200).default(400),
      saveTo: z.string().min(1).max(80).optional().describe('Chemin de l\u0027état où ranger le résultat (ex : game)'),
      parseJson: z.boolean().default(false).describe('Ranger le résultat comme objet JSON (le prompt doit exiger du JSON)'),
    }),
    /** Branchement conditionnel. */
    z.object({
      type: z.literal('if'),
      condition: ConditionSpecSchema,
      then: z.array(PipelineStepSchema).min(1).max(8),
      else: z.array(PipelineStepSchema).max(8).optional(),
    }),
    /** Itération bornée sur une liste (membres d'un rôle / records). */
    z.object({
      type: z.literal('forEach'),
      over: z.enum(['roleMembers', 'records']),
      roleId: z.string().min(15).optional(),
      collection: z.string().min(1).max(40).optional(),
      limit: z.number().int().min(1).max(100).default(25),
      as: z.enum(['member', 'record']).default('member'),
      steps: z.array(PipelineStepSchema).min(1).max(8),
    }),
    /** CAS atomique (ICacheStore SET NX) : exactement UN gagnant. */
    z.object({
      type: z.literal('claimOnce'),
      key: Macro,
      ttlSec: z.number().int().min(1).max(86_400).default(60),
      winnerVar: z.string().min(1).max(30).default('claimed'),
    }),
  ]),
);
