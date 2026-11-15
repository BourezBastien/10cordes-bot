import { Injectable } from '@spraxium/common';
import { PermissionDeniedException, ValidationException } from '@spraxium/core';
import { PermissionFlagsBits } from 'discord.js';
import {
  analyzeDisableCascade,
  dependenciesToEnable,
  findModule,
  missingDependencies,
  type DisableCascade,
  type ModuleDescriptor,
} from '@10cordes/shared';
import { findModuleByCommand, MODULE_CATALOG } from './module.catalog';
import { moduleStateStore } from './module-state.store';
import { CooldownService } from './cooldown.service';
import { GuildModuleStateService } from './guild-module-state.service';
import { AuditService } from '../audit/audit.service';
import { ModuleChannelException } from './module-channel.exception';
import { ModuleDependencyException } from './module-dependency.exception';
import { ModuleDisabledException } from './module-disabled.exception';

export type ModuleScope = 'guild' | 'global';

/** Contexte d'exécution transmis par le guard (aucune dépendance discord.js ici). */
export interface CommandAccessContext {
  guildId: string | null;
  userId: string;
  channelId: string;
  memberRoleIds: string[];
  isAdministrator: boolean;
  commandName: string;
}

export interface DisableResult {
  applied: boolean;
  cascade?: DisableCascade;
  disabled: string[];
}

// Le guard global est instancié par le framework via `new` (sans DI) — le service
// s'enregistre ici à l'instantiation DI pour rendre le graphe accessible au guard.
let runtime: ModuleManagerService | undefined;

export function getModuleManager(): ModuleManagerService {
  if (!runtime) throw new Error('ModuleManagerService is not initialized yet.');
  return runtime;
}

/** Orchestrates global + per-guild module states, dependency graph, whitelists and quotas. */
@Injectable()
export class ModuleManagerService {
  constructor(
    private readonly guildStates: GuildModuleStateService,
    private readonly cooldowns: CooldownService,
    private readonly audit: AuditService,
  ) {
    runtime = this;
  }

  find(moduleId: string): ModuleDescriptor | undefined {
    return findModule(MODULE_CATALOG, moduleId);
  }

  /** Ensemble des modules actifs (global ∩ guild) — consommé par le ToolRegistry. */
  async activeModules(guildId: string | null): Promise<Set<string>> {
    return guildId ? this.guildActiveSet(guildId) : this.globalActiveSet();
  }

  /** État global + état du serveur fusionnés pour chaque module du catalogue. */
  async listModules(
    guildId: string | null,
  ): Promise<Array<ModuleDescriptor & { globalEnabled: boolean; guildEnabled: boolean | null }>> {
    return Promise.all(
      MODULE_CATALOG.map(async (module) => ({
        ...module,
        globalEnabled: moduleStateStore.isEnabled(module.id),
        guildEnabled: guildId ? await this.guildStates.isEnabled(guildId, module.id) : null,
      })),
    );
  }

  /** Active le module + toutes ses dépendances obligatoires inactives (ordre topologique). */
  async enableModule(scope: ModuleScope, guildId: string | null, moduleId: string): Promise<string[]> {
    const module = this.find(moduleId);
    if (!module) {
      throw new ValidationException({ field: 'module', reason: `Unknown module \`${moduleId}\`.` });
    }

    let active: Set<string>;
    let persist: (id: string) => Promise<void>;
    if (scope === 'global') {
      active = this.globalActiveSet();
      persist = (id) => Promise.resolve(moduleStateStore.setEnabled(id, true));
    } else {
      if (!guildId) throw new Error('Guild scope requires a guild context.');
      active = await this.guildActiveSet(guildId);
      const target = guildId;
      persist = (id) => this.guildStates.setEnabled(target, id, true);
    }

    const toEnable = [moduleId, ...dependenciesToEnable(MODULE_CATALOG, active, moduleId)];
    for (const id of toEnable) await persist(id);
    this.audit.record({
      guildId,
      source: 'discord',
      action: 'module.enable',
      targetId: moduleId,
      metadata: { scope, enabled: toEnable },
    });
    return toEnable;
  }

  /**
   * Désactive le module. Si des modules actifs en dépendent, renvoie la cascade
   * détaillée (à confirmer par l'utilisateur) sauf si `confirm` est déjà vrai.
   */
  async disableModule(
    scope: ModuleScope,
    guildId: string | null,
    moduleId: string,
    confirm: boolean,
  ): Promise<DisableResult> {
    if (!this.find(moduleId)) {
      throw new ValidationException({ field: 'module', reason: `Unknown module \`${moduleId}\`.` });
    }

    let active: Set<string>;
    let persist: (id: string) => Promise<void>;
    if (scope === 'global') {
      active = this.globalActiveSet();
      persist = (id) => Promise.resolve(moduleStateStore.setEnabled(id, false));
    } else {
      if (!guildId) throw new Error('Guild scope requires a guild context.');
      active = await this.guildActiveSet(guildId);
      const target = guildId;
      persist = (id) => this.guildStates.setEnabled(target, id, false);
    }

    if (!active.has(moduleId)) return { applied: false, disabled: [] };

    const cascade = analyzeDisableCascade(MODULE_CATALOG, active, moduleId);
    if (cascade.toDisable.length > 0 && !confirm) {
      return { applied: false, cascade, disabled: [] };
    }

    const all = [moduleId, ...cascade.toDisable];
    for (const id of all) await persist(id);
    this.audit.record({
      guildId,
      source: 'discord',
      action: 'module.disable',
      targetId: moduleId,
      metadata: { scope, disabled: all, confirmed: confirm },
    });
    return { applied: true, disabled: all };
  }

  /**
   * Pipeline d'accès complet d'une commande (appelé par le guard global) :
   * catalogue inconnu → pass ; global off → guild off → dépendances inactives
   * → whitelists → rôle requis → bypass admin → cooldown + quotas.
   */
  async assertCommandUsable(ctx: CommandAccessContext): Promise<void> {
    const module = findModuleByCommand(ctx.commandName);
    if (!module) return;

    if (!moduleStateStore.isEnabled(module.id)) throw new ModuleDisabledException(module.label);
    if (!ctx.guildId) return;

    if (!(await this.guildStates.isEnabled(ctx.guildId, module.id))) {
      throw new ModuleDisabledException(module.label);
    }

    const active = await this.guildActiveSet(ctx.guildId);
    const missing = missingDependencies(MODULE_CATALOG, active, module.id);
    if (missing.length > 0) {
      const labels = missing
        .map((id) => findModule(MODULE_CATALOG, id)?.label ?? id)
        .join(', ');
      throw new ModuleDependencyException(module.label, labels);
    }

    const constraints = await this.guildStates.getConstraints(ctx.guildId, module.id);
    if (constraints.exemptUsers.includes(ctx.userId)) return;
    if (constraints.channels.length > 0 && !constraints.channels.includes(ctx.channelId)) {
      throw new ModuleChannelException(module.label);
    }
    if (
      constraints.requiredRoles.length > 0 &&
      !constraints.requiredRoles.some((roleId) => ctx.memberRoleIds.includes(roleId))
    ) {
      throw new PermissionDeniedException({ permission: module.label });
    }

    if (constraints.adminBypass && ctx.isAdministrator) return;
    this.cooldowns.check(ctx.guildId, ctx.userId, ctx.memberRoleIds, module.id, constraints);
  }

  private globalActiveSet(): Set<string> {
    return new Set(MODULE_CATALOG.filter((module) => moduleStateStore.isEnabled(module.id)).map((m) => m.id));
  }

  private async guildActiveSet(guildId: string): Promise<Set<string>> {
    const active = new Set<string>();
    for (const module of MODULE_CATALOG) {
      if (!moduleStateStore.isEnabled(module.id)) continue;
      if (await this.guildStates.isEnabled(guildId, module.id)) active.add(module.id);
    }
    return active;
  }
}
