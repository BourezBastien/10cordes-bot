import type { BotTool } from '@10cordes/shared';
import { z } from 'zod';
import type { OpenAiTool } from './llm.service';

/**
 * Routage des tools (pattern Anthropic) : un noyau TOUJOURS injecté, le reste
 * du catalogue joignable via search_tools, qui élève le tool trouvé dans le
 * toolset actif à la volée.
 */

/** Noyau volontairement PETIT : toujours injecté, lecture et dialogue de base. */
export const TOOL_CORE_NAMES = new Set([
  'getServerInfo',
  'getChannels',
  'getMembers',
  'getMemberInfo',
  'sendMessage',
  'readMessages',
  'announceStep',
  'search_tools',
  'getAvailableTools',
  'searchInternet',
  'searchWikipedia',
  'saveServerMemory',
  'saveMemberMemory',
  'getMemberMemory',
]);

/** Plafond de tools pertinents (hors noyau) injectés au modèle. */
export const MAX_INJECTED_TOOLS = 24;

/**
 * Sélection par pertinence : noyau structurel TOUJOURS inclus + les tools
 * dont nom/description/catégorie partagent des mots avec la demande.
 * Objectif : réduire la surface injectée (over-tooled agent = chute de
 * précision de sélection) sans jamais priver le modèle d'un tool critique.
 */
export function selectRelevantTools(content: string, tools: BotTool[]): BotTool[] {
  const words = new Set(
    content
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter((word) => word.length > 3),
  );
  const scored = tools.map((tool) => {
    if (TOOL_CORE_NAMES.has(tool.name)) return { tool, score: 1000 };
    const haystack = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
    let score = 0;
    for (const word of words) if (haystack.includes(word)) score += 1;
    return { tool, score };
  });
  const kept = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INJECTED_TOOLS)
    .map((entry) => entry.tool);
  for (const tool of tools) {
    if (TOOL_CORE_NAMES.has(tool.name) && !kept.includes(tool)) kept.push(tool);
  }
  return kept.length > 0 ? kept : tools;
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
