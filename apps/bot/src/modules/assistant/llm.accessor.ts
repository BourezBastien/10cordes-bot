import type { LlmService } from './llm.service';

/**
 * Accesseur runtime pour LlmService : les consommateurs hors du container
 * d'AssistantModule (curator mémoire, guards) l'appellent au moment de la
 * requête, après le chargement complet des modules.
 */
let instance: LlmService | undefined;

export function setLlmAccessor(service: LlmService): void {
  instance = service;
}

export function getLlm(): LlmService {
  if (!instance) throw new Error('LlmService non initialisé (boot incomplet).');
  return instance;
}
