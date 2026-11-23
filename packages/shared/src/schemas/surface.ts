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
 *
 * Répartition : un fichier par concept, dans l'ordre des dépendances (un
 * fichier n'importe que des concepts déjà définis, aucun cycle) :
 * - surface-macro.ts : la chaîne interpolée (Macro), interne au paquet ;
 * - surface-condition.ts : ConditionSpec (spécification de condition) ;
 * - surface-access-policy.ts : AccessPolicy d'un binding ;
 * - surface-modal.ts : ModalInput et ModalSpec ;
 * - surface-pipeline-step.ts : PipelineStep (étapes d'ActionPipeline) ;
 * - surface-binding.ts : InteractionBinding ;
 * - surface-definition.ts : SurfaceRow, SurfaceDefinition et leur validation ;
 * - surface-trigger.ts : ScheduledTriggerKind et TriggerStatus.
 *
 * Façade publique : c'est le seul fichier de ce dossier ré-exporté par
 * l'index du paquet. Elle ré-exporte nommément les mêmes symboles qu'avant
 * le découpage (Macro reste interne).
 */

export { ConditionSpecSchema, type ConditionSpec, type StateOp } from './surface-condition.js';
export { AccessPolicySchema, type AccessPolicy } from './surface-access-policy.js';
export { ModalInputSchema, ModalSpecSchema, type ModalInput, type ModalSpec } from './surface-modal.js';
export { PipelineStepSchema, type PipelineStep } from './surface-pipeline-step.js';
export { InteractionBindingSchema, type InteractionBinding } from './surface-binding.js';
export { SurfaceDefinitionSchema, SurfaceRowSchema, validateSurfaceDefinition, type SurfaceDefinition } from './surface-definition.js';
export { ScheduledTriggerKind, TriggerStatus } from './surface-trigger.js';
