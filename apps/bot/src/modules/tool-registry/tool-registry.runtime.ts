import type { Client } from 'discord.js';
import type { PrismaService } from '../database/prisma.service';
import type { GuildRulesService } from '../rules/guild-rules.service';
import type { CacheStoreService } from '../../shared/cache/cache-store.service';
import type { ToolRegistryService } from './tool-registry.service';

/**
 * Accès runtime au registry et dépendances runtime du registry lui-même
 * (elles cassent des cycles DI) : règles serveur, cache, prisma, client, rendu
 * de surface. Les providers propriétaires les lient dans leur onBoot.
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
  cache?: CacheStoreService;
  prisma?: PrismaService;
  client?: Client;
  renderSurface?: (surfaceId: string) => Promise<void>;
}

export const registryRuntimeDeps: RegistryRuntimeDeps = {};

export function bindRegistryRuntimeDeps(deps: Partial<RegistryRuntimeDeps>): void {
  Object.assign(registryRuntimeDeps, deps);
}

/** Auto-diagnostic : dépendances runtime effectivement liées (logs de boot, rigs). */
export function registryRuntimeDepsReady(): { cache: boolean; prisma: boolean; renderSurface: boolean; rules: boolean } {
  return {
    cache: registryRuntimeDeps.cache !== undefined,
    prisma: registryRuntimeDeps.prisma !== undefined,
    renderSurface: registryRuntimeDeps.renderSurface !== undefined,
    rules: registryRuntimeDeps.rules !== undefined,
  };
}
