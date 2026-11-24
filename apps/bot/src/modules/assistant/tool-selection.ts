import type { BotTool } from '@10cordes/shared';
import { rankTools, wordsOf } from '@10cordes/shared';
import { z } from 'zod';
import type { OpenAiTool } from './llm.service';

/**
 * Routage des tools (pattern Anthropic) : un noyau TOUJOURS injecté, le reste
 * du catalogue joignable via search_tools, qui élève le tool trouvé dans le
 * toolset actif à la volée.
 */

/**
 * Noyau : toujours injecté. Lecture et dialogue de base, plus les primitives
 * du moteur générique. Épinglées, elles sont visibles dès le tour 1 : laissées
 * derrière search_tools, le modèle cherchait 8 fois sans jamais les appeler
 * (tickets.surface, 23/11).
 */
export const TOOL_CORE_NAMES = new Set([
  'getServerInfo',
  'getChannels',
  'getMembers',
  'getMemberInfo',
  'sendMessage',
  'readMessages',
  'search_tools',
  'getAvailableTools',
  'searchInternet',
  'searchWikipedia',
  'saveServerMemory',
  'saveMemberMemory',
  'getMemberMemory',
  'surface.create',
  'surface.patchState',
  'surface.updateComponent',
  'trigger.schedule',
  'trigger.cancelByKey',
  'search_skills',
]);

/** Plafond de tools pertinents (hors noyau) injectés au modèle. */
export const MAX_INJECTED_TOOLS = 24;

const isCore = (tool: BotTool): boolean => TOOL_CORE_NAMES.has(tool.name);

/**
 * Sélection par pertinence : noyau TOUJOURS inclus + les tools dont le nom,
 * les mots-clés, la description ou la catégorie répondent à la demande. Le
 * plafond ne compte que les tools hors noyau.
 * Objectif : réduire la surface injectée (over-tooled agent = chute de
 * précision de sélection) sans jamais priver le modèle d'un tool critique.
 */
export function selectRelevantTools(content: string, tools: BotTool[]): BotTool[] {
  const kept = rankTools(
    tools.filter((tool) => !isCore(tool)),
    wordsOf(content, 4),
    MAX_INJECTED_TOOLS,
  );
  for (const tool of tools) {
    if (isCore(tool) && !kept.includes(tool)) kept.push(tool);
  }
  return kept.length > 0 ? kept : tools;
}

/** Consignes des tools épinglés présents dans le toolset, pour le prompt système dès le tour 1. */
export function pinnedToolGuidance(tools: readonly BotTool[]): string[] {
  return tools.filter((tool) => isCore(tool) && tool.systemPrompt).map((tool) => `${tool.name} : ${tool.systemPrompt}`);
}

/** Tool -> définition OpenAI (schéma Zod -> JSON Schema, fallback vide si irréductible). */
export function toolToOpenAiTool(tool: BotTool): OpenAiTool {
  let parameters: Record<string, unknown> = { type: 'object', properties: {} };
  try {
    parameters = z.toJSONSchema(tool.paramsSchema) as Record<string, unknown>;
  } catch {
    // Schéma non sérialisable : le modèle recevra une fonction sans paramètres.
  }
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters },
  };
}
