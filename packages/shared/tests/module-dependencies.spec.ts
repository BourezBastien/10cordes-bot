import { describe, expect, it } from 'vitest';
import {
  analyzeDisableCascade,
  dependenciesToEnable,
  missingDependencies,
  type ModuleDescriptor,
} from '../src/index.js';

const catalog: ModuleDescriptor[] = [
  { id: 'economy', label: 'Economy', description: '', dependsOn: [] },
  { id: 'shop', label: 'Shop', description: '', dependsOn: ['economy'] },
  { id: 'scoreboard', label: 'Scoreboard', description: '', dependsOn: ['economy'] },
  { id: 'levels', label: 'Levels', description: '', dependsOn: [] },
  { id: 'role-rewards', label: 'Role rewards', description: '', dependsOn: ['levels'] },
  { id: 'gear', label: 'Gear', description: '', dependsOn: ['shop', 'levels'] },
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
      { id: 'stats', label: 'Stats', description: '', dependsOn: ['gear'] },
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

describe('cas limites', () => {
  const diamond: ModuleDescriptor[] = [
    { id: 'top', label: 'Top', description: '', dependsOn: ['left', 'right'] },
    { id: 'left', label: 'Left', description: '', dependsOn: ['base'] },
    { id: 'right', label: 'Right', description: '', dependsOn: ['base'] },
    { id: 'base', label: 'Base', description: '', dependsOn: [] },
  ];

  it('un module absent du catalogue n\u0027a rien à activer', () => {
    expect(missingDependencies(catalog, new Set(), 'ghost')).toEqual([]);
    expect(dependenciesToEnable(catalog, new Set(), 'ghost')).toEqual([]);
  });

  it('une dépendance absente du catalogue n\u0027arrête pas le parcours', () => {
    const orphan: ModuleDescriptor[] = [
      { id: 'orphan', label: 'Orphan', description: '', dependsOn: ['phantom'] },
      { id: 'child', label: 'Child', description: '', dependsOn: ['orphan'] },
    ];
    // État actuel, pas une garantie : la dépendance inconnue figure dans la liste.
    expect(dependenciesToEnable(orphan, new Set(), 'child')).toEqual(['phantom', 'orphan']);
    expect(missingDependencies(orphan, new Set(['orphan', 'phantom']), 'child')).toEqual([]);
  });

  it('une dépendance commune à deux branches n\u0027est activée qu\u0027une fois, au fond', () => {
    expect(dependenciesToEnable(diamond, new Set(), 'top')).toEqual(['base', 'left', 'right']);
  });

  it('un cycle entre deux modules s\u0027arrête, sans doublon', () => {
    const cycle: ModuleDescriptor[] = [
      { id: 'yin', label: 'Yin', description: '', dependsOn: ['yang'] },
      { id: 'yang', label: 'Yang', description: '', dependsOn: ['yin'] },
    ];
    expect(dependenciesToEnable(cycle, new Set(), 'yin')).toEqual(['yang']);
  });

  it('les modules actifs absents du catalogue sont ignorés, et la cible n\u0027est jamais conservée', () => {
    const cascade = analyzeDisableCascade(catalog, new Set(['economy', 'shop', 'ghost']), 'economy');
    expect(cascade).toEqual({ target: 'economy', toDisable: ['shop'], kept: [] });
  });
});
