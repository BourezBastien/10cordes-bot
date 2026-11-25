import { Injectable } from '@spraxium/common';
import { ValidationException } from '@spraxium/core';
import {
  analyzeDisableCascade,
  dependenciesToEnable,
  findModule,
  type DisableCascade,
  type ModuleDescriptor,
} from '@10cordes/shared';
import { MODULE_CATALOG } from './module.catalog';
import { GuildModuleStateService } from './guild-module-state.service';
import type { AuditEntry } from '../audit/audit.service';
import { AuditService } from '../audit/audit.service';

/** Origine d'une écriture, pour l'audit : les outils Discord par défaut, l'API du dashboard sinon. */
type AuditSource = NonNullable<AuditEntry['source']>;

export interface DisableResult {
  applied: boolean;
  cascade?: DisableCascade;
  disabled: string[];
}

/**
 * Toggles de modules PAR SERVEUR (dashboard + tools getModules/enable/
 * disableModule). (22/11) Le pipeline d'accès complet (guard global,
 * cooldowns, quotas, scope global JSON, exceptions) est SUPPRIMÉ : il était
 * totalement inerte (0 slash command, 0 tool avec requiredModules, guard
 * retournant toujours true). Le filtre requiredModules du ToolRegistry
 * reste branché sur activeModules().
 */
@Injectable()
export class ModuleManagerService {
  constructor(
    private readonly guildStates: GuildModuleStateService,
    private readonly audit: AuditService,
  ) {}

  find(moduleId: string): ModuleDescriptor | undefined {
    return findModule(MODULE_CATALOG, moduleId);
  }

  /** Modules actifs sur le serveur, consommés par le ToolRegistry (filtre requiredModules). */
  async activeModules(guildId: string | null): Promise<Set<string>> {
    if (!guildId) return new Set(MODULE_CATALOG.map((module) => module.id));
    const active = new Set<string>();
    for (const module of MODULE_CATALOG) {
      if (await this.guildStates.isEnabled(guildId, module.id)) active.add(module.id);
    }
    return active;
  }

  /** État par serveur pour chaque module du catalogue (dashboard). */
  async listModules(
    guildId: string | null,
  ): Promise<Array<ModuleDescriptor & { globalEnabled: boolean; guildEnabled: boolean | null }>> {
    return Promise.all(
      MODULE_CATALOG.map(async (module) => ({
        ...module,
        globalEnabled: true,
        guildEnabled: guildId ? await this.guildStates.isEnabled(guildId, module.id) : null,
      })),
    );
  }

  /**
   * Active le module + toutes ses dépendances obligatoires inactives (ordre
   * topologique). `actorId` et `source` disent qui demande le changement : sans
   * eux (outils Discord), l'audit reste tel quel, sans acteur.
   */
  async enableModule(guildId: string, moduleId: string, actorId?: string, source: AuditSource = 'discord'): Promise<string[]> {
    const module = this.find(moduleId);
    if (!module) {
      throw new ValidationException({ field: 'module', reason: `Unknown module \`${moduleId}\`.` });
    }
    const active = await this.activeModules(guildId);
    const toEnable = [moduleId, ...dependenciesToEnable(MODULE_CATALOG, active, moduleId)];
    for (const id of toEnable) await this.guildStates.setEnabled(guildId, id, true);
    this.audit.record({
      guildId,
      source,
      action: 'module.enable',
      ...(actorId ? { actorId } : {}),
      targetId: moduleId,
      metadata: { enabled: toEnable },
    });
    return toEnable;
  }

  /**
   * Désactive le module. Si des modules actifs en dépendent, renvoie la cascade
   * détaillée (à confirmer par l'utilisateur) sauf si `confirm` est déjà vrai.
   * `actorId` et `source` : voir `enableModule`.
   */
  async disableModule(guildId: string, moduleId: string, confirm: boolean, actorId?: string, source: AuditSource = 'discord'): Promise<DisableResult> {
    if (!this.find(moduleId)) {
      throw new ValidationException({ field: 'module', reason: `Unknown module \`${moduleId}\`.` });
    }
    const active = await this.activeModules(guildId);
    if (!active.has(moduleId)) return { applied: false, disabled: [] };

    const cascade = analyzeDisableCascade(MODULE_CATALOG, active, moduleId);
    if (cascade.toDisable.length > 0 && !confirm) {
      return { applied: false, cascade, disabled: [] };
    }

    const all = [moduleId, ...cascade.toDisable];
    for (const id of all) await this.guildStates.setEnabled(guildId, id, false);
    this.audit.record({
      guildId,
      source,
      action: 'module.disable',
      ...(actorId ? { actorId } : {}),
      targetId: moduleId,
      metadata: { disabled: all, confirmed: confirm },
    });
    return { applied: true, disabled: all };
  }
}
