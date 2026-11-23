import { z } from 'zod';

/**
 * MOTEUR GÉNÉRIQUE (Phase 2.4) — schémas de InteractiveSurface /
 * InteractionBinding / ScheduledTrigger / EventTrigger / ActionPipeline.
 *
 * Principe : TOUT système interactif (tickets, sondages, vocaux temporaires,
 * captcha...) est construit par l'agent en composant ces primitives. Le
 * rendu est Components V2 data-driven, les interactions passent par LE trio
 * de handlers génériques (surface:act / surface:select / surface:modal), la
 * persistance survit aux redémarrages (DB), les délais passent par la queue
 * durable (rattrapage garanti, plus de fenêtre de grâce).
 *
 * Interpolation : les chaînes supportent {{actor.id}}, {{actor.username}},
 * {{state.<path>}}, {{steps.<n>.<field>}}, {{surface.channelId}},
 * {{surface.messageId}}, {{guild.id}} — résolues au runtime, JAMAIS choisies
 * par le modèle pour les identités (actor.id vient du contexte Discord).
 */

const Macro = z.string().max(600);

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

// ── AccessPolicy ────────────────────────────────────────────────────

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

// ── Modals (max 5 champs, règle API v10) ───────────────────────────

export const ModalInputSchema = z.object({
  id: z.string().min(1).max(45),
  label: z.string().min(1).max(45),
  style: z.enum(['short', 'paragraph']).default('short'),
  placeholder: z.string().max(100).optional(),
  required: z.boolean().default(true),
  minLength: z.number().int().min(0).max(4000).optional(),
  maxLength: z.number().int().min(1).max(4000).optional(),
});
export type ModalInput = z.infer<typeof ModalInputSchema>;

export const ModalSpecSchema = z.object({
  title: z.string().min(1).max(45),
  inputs: z.array(ModalInputSchema).min(1).max(5),
});
export type ModalSpec = z.infer<typeof ModalSpecSchema>;

// ── ActionPipeline (Command + Composite) ────────────────────────────

/** Union manuelle (récursivité via if/forEach/trigger.schedule imbriqués). */
export type PipelineStep =
  | { type: 'runTool'; name: string; input: Record<string, unknown> }
  | { type: 'setState'; path: string; value?: string | number | boolean | null; mode: 'set' | 'increment' | 'decrement' | 'toggle' }
  | { type: 'updateComponent'; binding: string; patch: { label?: string; style?: 'primary' | 'secondary' | 'success' | 'danger'; emoji?: string; disabled?: boolean } }
  | { type: 'sendMessage'; channelId?: string; content: string }
  | { type: 'replyEphemeral'; content: string }
  | { type: 'openModal'; modal: ModalSpec }
  | { type: 'record.write'; collection: string; data: Record<string, unknown> }
  | { type: 'trigger.schedule'; key?: string; delaySec?: number; cron?: string; condition?: ConditionSpec; steps: PipelineStep[] }
  | { type: 'trigger.cancelByKey'; key: string }
  | { type: 'random'; min: number; max: number }
  | { type: 'llm'; prompt: string; maxChars: number }
  | { type: 'if'; condition: ConditionSpec; then: PipelineStep[]; else?: PipelineStep[] }
  | { type: 'forEach'; over: 'roleMembers' | 'records'; roleId?: string; collection?: string; limit: number; as: 'member' | 'record'; steps: PipelineStep[] }
  | { type: 'claimOnce'; key: string; ttlSec: number; winnerVar: string };

export const PipelineStepSchema: z.ZodType<PipelineStep> = z.lazy(() =>
  z.discriminatedUnion('type', [
    /** Exécute un tool du registry (typé RegisteredToolName côté consommateur). */
    z.object({
      type: z.literal('runTool'),
      name: z.string().min(3).max(60),
      input: z.record(z.string(), z.unknown()).default({}),
    }),
    /** Mutation de l'état de la surface. */
    z.object({
      type: z.literal('setState'),
      path: z.string().min(1).max(80),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
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
      key: z.string().min(1).max(80).optional().describe('Clé d\'annulation (cancelByKey)'),
      delaySec: z.number().int().min(1).max(86_400 * 90).optional(),
      cron: z.string().min(5).max(60).optional(),
      condition: ConditionSpecSchema.optional().describe('Exécuté seulement si la spec passe à l\'échéance'),
      steps: z.array(PipelineStepSchema).min(1).max(10),
    }),
    /** Annule un trigger planifié par sa clé (ex : suppression vocal annulée). */
    z.object({ type: z.literal('trigger.cancelByKey'), key: z.string().min(1).max(80) }),
    /** Aléatoire borné → variable steps.N.value. */
    z.object({ type: z.literal('random'), min: z.number().int(), max: z.number().int() }),
    /** LLM : prompt interpolé → steps.N.text (résumés, reformulations). */
    z.object({ type: z.literal('llm'), prompt: z.string().min(3).max(1200), maxChars: z.number().int().min(20).max(1200).default(400) }),
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

// ── InteractionBinding ──────────────────────────────────────────────

export const InteractionBindingSchema = z.object({
  /** Clé courte stable : voyage dans le customId (surface:act~b=key). */
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,29}$/u, 'clé kebab-case ≤30 chars'),
  label: z.string().min(1).max(80),
  emoji: z.string().max(16).optional(),
  style: z.enum(['primary', 'secondary', 'success', 'danger']).default('primary'),
  disabled: z.boolean().default(false),
  /** Valeur d'option (select) ou description. */
  description: z.string().max(100).optional(),
  access: AccessPolicySchema.default({}),
  pipeline: z.array(PipelineStepSchema).min(1).max(10),
  /** Select multi : valeurs min/max sélectionnables. */
  minValues: z.number().int().min(1).max(25).optional(),
  maxValues: z.number().int().min(1).max(25).optional(),
});
export type InteractionBinding = z.infer<typeof InteractionBindingSchema>;

// ── SurfaceDefinition (layout V2 data-driven) ───────────────────────

export const SurfaceRowSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('buttons'),
    buttons: z.array(InteractionBindingSchema).min(1).max(5),
  }),
  z.object({
    kind: z.literal('select'),
    select: z.object({
      placeholder: z.string().max(100).default('Choisis une option'),
      options: z.array(InteractionBindingSchema).min(1).max(25),
    }),
  }),
]);

export const SurfaceDefinitionSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(3400).optional(),
  accentColor: z.number().int().min(0).max(0xffffff).optional(),
  footer: z.string().max(200).optional(),
  thumbnailUrl: z.string().url().max(500).optional(),
  imageUrl: z.string().url().max(500).optional(),
  rows: z.array(SurfaceRowSchema).max(10),
  /** État initial JSON (compteurs, propriétaire, grilles...). */
  initialState: z.record(z.string(), z.unknown()).default({}),
});
export type SurfaceDefinition = z.infer<typeof SurfaceDefinitionSchema>;

// ── Triggers ────────────────────────────────────────────────────────

export const ScheduledTriggerKind = z.enum(['once', 'cron', 'interval']);

export const TriggerStatus = z.enum(['armed', 'done', 'cancelled']);

/**
 * Validation runtime d'une définition complète : bindings aux clés uniques,
 * openModal uniquement en 1re position, budget 10 000 octets des TextDisplay.
 * (Utilisée par le renderer ET le tool surface.create.)
 */
/** Longueur UTF-8 d'une chaîne sans dépendre de Buffer (shared). */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function validateSurfaceDefinition(definition: SurfaceDefinition): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  let textBytes = 0;
  const countBytes = (value: string | undefined) => {
    if (value) textBytes += utf8ByteLength(value);
  };
  countBytes(definition.title);
  countBytes(definition.description);
  countBytes(definition.footer);
  if (textBytes > 10_000) errors.push(`Textes trop lourds (${textBytes} octets > 10 000 : limite Components V2).`);
  for (const row of definition.rows) {
    const bindings = row.kind === 'buttons' ? row.buttons : row.select.options;
    for (const binding of bindings) {
      if (keys.has(binding.key)) errors.push(`Clé de binding dupliquée : ${binding.key}.`);
      keys.add(binding.key);
      const first = binding.pipeline[0];
      if (binding.pipeline.some((step) => step.type === 'openModal') && first?.type !== 'openModal') {
        errors.push(`openModal doit être la PREMIÈRE étape de ${binding.key} (règle des 3 s de l'API Discord).`);
      }
    }
  }
  return errors;
}
