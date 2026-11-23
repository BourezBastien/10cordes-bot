import type { BotTool } from '@10cordes/shared';
import { TOOL_CORE_NAMES } from './tool-selection';

/**
 * Intention d'une demande, décidée AVANT son premier tour : orientée ACTION
 * (une recette correspond à la demande, ou un tool modifiant est routé) ou
 * simple conversation. Elle fixe l'effort de raisonnement de toute la requête.
 * Heuristique volontairement prudente : en cas de doute, une demande passe
 * pour une action (coût : un peu de latence, jamais de régression de qualité).
 */

/** Nom de tool qui n'annonce qu'une lecture : il ne signale pas une action. */
const READ_ONLY_NAME_RE =
  /^(?:get|search|read|list|find|analyze|describe|lookup|fetch|calc|translate|wiki|dictionary|weather|server|blueprint|skills|activity|rules\b|web\.|openSkill$|tool-registry|records\.(?:collections|get|list|search)$|members\.(?:get|list|pick))/u;

export interface RequestIntent {
  /** La demande appelle une action (recette ou modification). */
  action: boolean;
  /** Recettes dont le déclencheur correspond à la demande (lignes `id | trigger`). */
  matchedSkills: string[];
  /** Tools modifiants routés pour la demande. */
  mutatingTools: string[];
}

/** Mots significatifs d'un déclencheur (5 lettres ou plus). */
function triggerWords(trigger: string): string[] {
  return trigger.toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]{5,}/gu) ?? [];
}

/**
 * Un déclencheur correspond-il à la demande ? Un mot long (6 lettres et plus)
 * commun suffit ; sinon deux mots moyens. Évite les faux positifs sur les
 * mots de liaison.
 */
function triggerMatches(line: string, request: string): boolean {
  const separator = line.indexOf(' | ');
  const words = triggerWords(separator >= 0 ? line.slice(separator + 3) : line);
  const text = request.toLowerCase().normalize('NFC');
  const shared = words.filter((word) => text.includes(word));
  return shared.some((word) => word.length >= 6) || shared.length >= 2;
}

export function detectRequestIntent(request: string, routedTools: readonly BotTool[], skillTriggers: readonly string[]): RequestIntent {
  const mutatingTools = routedTools.filter((tool) => !TOOL_CORE_NAMES.has(tool.name) && !READ_ONLY_NAME_RE.test(tool.name)).map((tool) => tool.name);
  const matchedSkills = skillTriggers.filter((line) => triggerMatches(line, request));
  return { action: mutatingTools.length > 0 || matchedSkills.length > 0, matchedSkills, mutatingTools };
}
