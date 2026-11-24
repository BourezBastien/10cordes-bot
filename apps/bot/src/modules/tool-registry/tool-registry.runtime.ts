import type { GuildRulesService } from '../rules/guild-rules.service';
import type { ToolRegistryService } from './tool-registry.service';

/**
 * Accès runtime au registry, et dépendance runtime du registry lui-même
 * (elle casse un cycle DI) : les règles serveur. Le provider propriétaire
 * (`GuildRulesService.onBoot`) la lie.
 *
 * Le plan d'action, lui, est atteint par son propre accesseur
 * (`getActionPlans`, module action-plan) : son service injecte le registry.
 */

let registryInstance: ToolRegistryService | undefined;

/** Accès runtime au registry pour les contextes sans DI (guards, layouts, calls externes). */
export function getToolRegistry(): ToolRegistryService {
  if (!registryInstance) throw new Error('ToolRegistryService is not initialized yet.');
  return registryInstance;
}

/** Retient l'instance unique (appelé par le constructeur du registry). */
export function bindRegistryInstance(instance: ToolRegistryService): void {
  registryInstance = instance;
}

export interface RegistryRuntimeDeps {
  rules?: GuildRulesService;
}

export const registryRuntimeDeps: RegistryRuntimeDeps = {};

export function bindRegistryRuntimeDeps(deps: Partial<RegistryRuntimeDeps>): void {
  Object.assign(registryRuntimeDeps, deps);
}

/** Auto-diagnostic : dépendance runtime effectivement liée (logs de boot, rigs). */
export function registryRuntimeDepsReady(): { rules: boolean } {
  return { rules: registryRuntimeDeps.rules !== undefined };
}
