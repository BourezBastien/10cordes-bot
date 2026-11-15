import { describe, expect, it } from 'vitest';
import {
  analyzeDisableCascade,
  dependenciesToEnable,
  missingDependencies,
  type ModuleDescriptor,
} from '../src/index.js';

const catalog: ModuleDescriptor[] = [
  { id: 'economy', label: 'Economy', description: '', commands: [], dependsOn: [] },
  { id: 'shop', label: 'Shop', description: '', commands: [], dependsOn: ['economy'] },
  { id: 'scoreboard', label: 'Scoreboard', description: '', commands: [], dependsOn: ['economy'] },
  { id: 'levels', label: 'Levels', description: '', commands: [], dependsOn: [] },
  { id: 'role-rewards', label: 'Role rewards', description: '', commands: [], dependsOn: ['levels'] },
  { id: 'gear', label: 'Gear', description: '', commands: [], dependsOn: ['shop', 'levels'] },
];

describe('missingDependencies', () => {
  it('returns empty when all dependencies are active', () => {
    expect(missingDependencies(catalog, new Set(['levels']), 'role-rewards')).toEqual([]);
  });

  it('lists inactive dependencies', () => {
    expect(missingDependencies(catalog, new Set(['levels']), 'shop')).toEqual(['economy']);
  });
});

describe('dependenciesToEnable', () => {
  it('collects transitive dependencies in topological order', () => {
    expect(dependenciesToEnable(catalog, new Set(), 'shop')).toEqual(['economy']);
    expect(dependenciesToEnable(catalog, new Set(), 'gear')).toEqual(['economy', 'shop', 'levels']);
  });

  it('skips already-active dependencies', () => {
    expect(dependenciesToEnable(catalog, new Set(['levels']), 'gear')).toEqual(['economy', 'shop']);
  });
});

describe('analyzeDisableCascade', () => {
  it('disables modules no longer protected once their protector falls', () => {
    const active = new Set(['economy', 'shop', 'scoreboard', 'levels', 'gear']);
    const cascade = analyzeDisableCascade(catalog, active, 'economy');
    // 1er passage : shop est protégé par gear (actif) → gear n'est pas cassé, scoreboard tombe.
    // 2e passage : rien ne requiert plus gear… mais gear ne dépend que de shop (actif) et levels (actif)
    // → gear et shop SURVIVENT tous les deux ; seul scoreboard (dépendance economy directe) tombe.
    expect(cascade.toDisable).toEqual(['scoreboard']);
    expect(cascade.kept).toEqual(['shop']);
  });

  it('keeps the whole protected chain required by another active module', () => {
    const catalogWithStats: ModuleDescriptor[] = [
      ...catalog,
      { id: 'stats', label: 'Stats', description: '', commands: [], dependsOn: ['gear'] },
    ];
    const active = new Set(['economy', 'shop', 'scoreboard', 'levels', 'gear', 'stats']);
    const cascade = analyzeDisableCascade(catalogWithStats, active, 'economy');
    // stats requiert gear → gear survit (et n'est jamais "cassé") → shop survit (protégé par gear) ;
    // kept = dépendants qui auraient cassé mais ont été protégés → seul shop ; scoreboard tombe.
    expect(cascade.toDisable).toEqual(['scoreboard']);
    expect(cascade.kept).toEqual(['shop']);
  });

  it('cascades fully when nothing protects the dependents', () => {
    const active = new Set(['economy', 'shop', 'scoreboard']);
    const cascade = analyzeDisableCascade(catalog, active, 'economy');
    expect(cascade.toDisable.sort()).toEqual(['scoreboard', 'shop']);
    expect(cascade.kept).toEqual([]);
  });

  it('returns nothing for a leaf module', () => {
    const cascade = analyzeDisableCascade(catalog, new Set(['levels', 'role-rewards']), 'role-rewards');
    expect(cascade.toDisable).toEqual([]);
    expect(cascade.kept).toEqual([]);
  });
});
