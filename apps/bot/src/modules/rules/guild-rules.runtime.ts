import type { GuildRulesService } from './guild-rules.service';

/**
 * Accès runtime à GuildRulesService (pattern getLlm) : consommé par des
 * modules chargés AVANT GuildRulesModule dans l'ordre d'AppModule.
 */
let instance: GuildRulesService | null = null;

export function bindGuildRules(service: GuildRulesService): void {
  instance = service;
}

export function getGuildRules(): GuildRulesService {
  if (!instance) throw new Error('GuildRulesService non initialisé (module non chargé)');
  return instance;
}
