import type { SkillBlueprint } from '@10cordes/shared';
import { automationBlueprints } from './blueprints/automation.blueprints';
import { communityBlueprints } from './blueprints/community.blueprints';
import { engagementBlueprints } from './blueprints/engagement.blueprints';
import { eventsBlueprints } from './blueprints/events.blueprints';
import { formsBlueprints } from './blueprints/forms.blueprints';
import { moderationBlueprints } from './blueprints/moderation.blueprints';
import { monitoringBlueprints } from './blueprints/monitoring.blueprints';
import { onboardingBlueprints } from './blueprints/onboarding.blueprints';
import { ticketsBlueprints } from './blueprints/tickets.blueprints';
import { voiceBlueprints } from './blueprints/voice.blueprints';

/**
 * BIBLIOTHÈQUE DE RECETTES officielles (P3.1b + C2) — 135 SkillBlueprint
 * sur 10 domaines (fichiers dédiés dans ./blueprints/).
 * Chaque recette est une COMPOSITION de primitives génériques
 * (surface.create, records.*, trigger.schedule, tools Discord) : zéro
 * handler métier en dur, tout passe par le moteur générique.
 *
 * requiredTools est vérifié À LA COMPILATION contre RegisteredToolName :
 * une recette référençant un tool inexistant casse `pnpm typecheck`.
 *
 * Rédaction : workflow déclaratif (étapes numérotées, pas de pseudo-code),
 * params 100 % configurables par le prompt utilisateur, tags multilingues.
 */
export const BLUEPRINT_LIBRARY: readonly SkillBlueprint[] = [
  ...ticketsBlueprints,
  ...voiceBlueprints,
  ...moderationBlueprints,
  ...onboardingBlueprints,
  ...formsBlueprints,
  ...engagementBlueprints,
  ...eventsBlueprints,
  ...automationBlueprints,
  ...monitoringBlueprints,
  ...communityBlueprints,
];
