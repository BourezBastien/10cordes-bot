import type { RegisteredToolName } from '../tools/registry-names.js';

/**
 * Moteur de Recettes (Phase 2.2) — contrat strict d'une Skill paramétrable.
 * Un SkillBlueprint est une recette DÉCLARATIVE : l'agent la sélectionne,
 * surcharge ses params avec les préférences formulées par l'utilisateur,
 * puis compose les primitives génériques (surface.*, records.*, triggers).
 * `requiredTools` est typé sur l'union réelle des tools enregistrés : un
 * skill référençant un tool inexistant ou renommé casse `pnpm typecheck`.
 */

export type SkillDomain =
  | 'tickets'
  | 'voice'
  | 'moderation'
  | 'onboarding'
  | 'forms'
  | 'engagement'
  | 'events'
  | 'monitoring'
  | 'automation'
  | 'community';

export type SkillParamType = 'string' | 'number' | 'boolean' | 'emoji' | 'duration' | 'cron' | 'channelId' | 'roleId';

export interface SkillParamSpec {
  readonly type: SkillParamType;
  readonly description: string;
  readonly defaultValue: string | number | boolean;
  readonly required?: boolean;
}

export interface SkillBlueprint {
  /** Identifiant stable kebab-case (clé de réutilisation). */
  readonly slug: string;
  readonly domain: SkillDomain;
  /** Mots-clés multilingues (FR, EN, ES...) pour le scoring de pertinence. */
  readonly tags: readonly string[];
  /** Intention déclencheuse (max 120 caractères). */
  readonly trigger: string;
  /** Paramètres 100 % configurables par le prompt utilisateur. */
  readonly params: Readonly<Record<string, SkillParamSpec>>;
  /** Tools nécessaires : typés, vérifiés à la compilation. */
  readonly requiredTools: readonly RegisteredToolName[];
  /** Étapes déclaratives (Composition V2 + triggers exécutés par BullMQ). */
  readonly workflow: string;
}

/** Contrat d'exécution résolu après extraction des préférences utilisateur. */
export interface ResolvedSkillExecution {
  readonly slug: string;
  readonly guildId: string;
  readonly requestedBy: string;
  /** Langue détectée du message utilisateur (textes visibles générés dedans). */
  readonly targetLocale: string;
  readonly resolvedParams: Record<string, string | number | boolean>;
}
