import type { BotTool } from './types.js';

/**
 * Pertinence d'un tool pour une demande, en mots de langue courante. Un seul
 * barème pour le routage initial (selectRelevantTools) et search_tools : le
 * tool trouvé par l'un est classé pareil par l'autre.
 */

const NAME_WEIGHT = 3;
const KEYWORD_WEIGHT = 2;
const TEXT_WEIGHT = 1;

/** Mots d'un texte (lettres et chiffres, Unicode) : minuscules, sans doublon, de longueur minimale donnée. */
export function wordsOf(text: string, minLength: number): string[] {
  const words = text
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= minLength);
  return [...new Set(words)];
}

/**
 * Score d'un tool : nom x3, mots-clés x2, description et catégorie x1, par mot
 * trouvé. Le nom et la description se comparent par inclusion, les mots-clés
 * par préfixe (le mot-clé est une racine : "bouton" couvre "boutons").
 */
export function toolMatchScore(tool: BotTool, words: readonly string[]): number {
  const name = tool.name.toLowerCase();
  const keywords = (tool.keywords ?? []).map((keyword) => keyword.toLowerCase());
  const haystack = `${tool.description} ${tool.category}`.toLowerCase();
  let score = 0;
  for (const raw of words) {
    const word = raw.normalize('NFC');
    if (name.includes(word)) score += NAME_WEIGHT;
    if (keywords.some((keyword) => word.startsWith(keyword))) score += KEYWORD_WEIGHT;
    if (haystack.includes(word)) score += TEXT_WEIGHT;
  }
  return score;
}

/** Tools classés par pertinence décroissante, score nul exclu ; à égalité, ordre du catalogue. */
export function rankTools(tools: readonly BotTool[], words: readonly string[], limit: number): BotTool[] {
  return tools
    .map((tool) => ({ tool, score: toolMatchScore(tool, words) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.tool);
}
