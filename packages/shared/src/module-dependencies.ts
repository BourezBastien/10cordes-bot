import type { ModuleDescriptor } from './types/module-descriptor.js';

/** Résultat d'une analyse de désactivation : ce qui tombe, ce qui survit. */
export interface DisableCascade {
  target: string;
  /** Modules actifs qui seraient désactivés en cascade (dépendants cassés). */
  toDisable: string[];
  /** Modules actifs dépendants qui SURVIVENT — requis par un autre module restant actif. */
  kept: string[];
}

export function findModule(catalog: ModuleDescriptor[], id: string): ModuleDescriptor | undefined {
  return catalog.find((module) => module.id === id);
}

/** Dépendances obligatoires de `id` qui sont inactives. */
export function missingDependencies(
  catalog: ModuleDescriptor[],
  active: ReadonlySet<string>,
  id: string,
): string[] {
  const module = findModule(catalog, id);
  if (!module) return [];
  return module.dependsOn.filter((dependency) => !active.has(dependency));
}

/**
 * Dépendances transitives à activer pour rendre `id` fonctionnel.
 * Ordre garanti : les dépendances de fond d'abord (topologique).
 */
export function dependenciesToEnable(
  catalog: ModuleDescriptor[],
  active: ReadonlySet<string>,
  id: string,
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>([id]);

  const visit = (moduleId: string): void => {
    const module = findModule(catalog, moduleId);
    if (!module) return;
    for (const dependency of module.dependsOn) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      visit(dependency);
      if (!active.has(dependency) && !ordered.includes(dependency)) ordered.push(dependency);
    }
  };

  visit(id);
  return ordered;
}

/** Un module est protégé si un autre module ACTIF (hors ensemble désactivé) le requiert. */
function isProtected(
  catalog: ModuleDescriptor[],
  active: ReadonlySet<string>,
  disabled: ReadonlySet<string>,
  id: string,
): boolean {
  return catalog.some(
    (other) =>
      other.id !== id && !disabled.has(other.id) && active.has(other.id) && other.dependsOn.includes(id),
  );
}

/**
 * Calcule la cascade de désactivation de `target` :
 * tout module actif dont une dépendance obligatoire devient inactive est désactivé,
 * SAUF s'il est lui-même requis par un autre module qui reste actif (protégé).
 */
export function analyzeDisableCascade(
  catalog: ModuleDescriptor[],
  active: ReadonlySet<string>,
  target: string,
): DisableCascade {
  const disabled = new Set<string>([target]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const module of catalog) {
      if (disabled.has(module.id) || !active.has(module.id)) continue;
      const broken = module.dependsOn.some((dependency) => disabled.has(dependency));
      if (!broken || isProtected(catalog, active, disabled, module.id)) continue;
      disabled.add(module.id);
      changed = true;
    }
  }

  const toDisable = [...disabled].filter((id) => id !== target && active.has(id));
  const kept = [...active].filter(
    (id) =>
      id !== target &&
      !toDisable.includes(id) &&
      (findModule(catalog, id)?.dependsOn.some((dependency) => disabled.has(dependency)) ?? false),
  );

  return { target, toDisable, kept };
}
