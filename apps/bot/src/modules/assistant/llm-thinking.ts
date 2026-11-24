/**
 * THINKING ADAPTATIF (réglage par serveur, défaut 'adaptive').
 *
 * Règle STABLE : l'effort de raisonnement d'une requête est décidé UNE seule
 * fois, AVANT son premier tour, puis envoyé identique sur tous ses tours.
 * Le faire basculer au fil d'une boucle (effort sur les tours à tools, absent
 * sur la synthèse) a coïncidé avec une fuite des balises internes du modèle.
 *
 * - off : jamais ;
 * - always : toujours (si l'endpoint l'accepte) ;
 * - adaptive : activé pour TOUTE la requête quand elle est orientée action
 *   (recette détectée, tool modifiant routé), désactivé sinon.
 */

import { isAnthropicHost, isDeepSeekHost as isDeepSeekEndpoint } from '../../shared/llm/chat-utils';

export type ThinkingMode = 'adaptive' | 'always' | 'off';

/** Le fournisseur accepte-t-il le champ reasoning_effort ? (DeepSeek, Anthropic ; OpenRouter/Groq/Gemini l'excluent.) */
export function endpointAcceptsThinking(baseUrl: string): boolean {
  return isDeepSeekEndpoint(baseUrl) || isAnthropicHost(baseUrl);
}

/**
 * Le fournisseur coupe-t-il le thinking avec `reasoning_effort: 'none'` ?
 * Chez DeepSeek, omettre le champ laisse l'effort PAR DÉFAUT (high) : couper
 * vraiment exige `none`. Ailleurs le champ est omis (jamais de valeur risquée).
 */
export function endpointDisablesThinkingWithNone(baseUrl: string): boolean {
  return isDeepSeekEndpoint(baseUrl);
}

/** La requête doit-elle penser, selon le mode du serveur ? (intent null : appel isolé, sans tools.) */
export function shouldEnableThinkingForRequest(mode: ThinkingMode, actionIntent: boolean | null): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return actionIntent === true;
}

/**
 * Valeur de `reasoning_effort` à envoyer : l'effort configuré quand on pense ;
 * `none` pour couper vraiment chez DeepSeek ; sinon le champ est omis (null).
 */
export function reasoningEffortValue(baseUrl: string, enabled: boolean, configuredEffort: string): string | null {
  if (enabled) return configuredEffort || null;
  return endpointDisablesThinkingWithNone(baseUrl) ? 'none' : null;
}
