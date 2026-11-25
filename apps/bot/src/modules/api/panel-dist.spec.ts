import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardDirCandidates, resolveDashboardDir } from './panel-dist';

/*
 * Dossier du panel compilé : `DASHBOARD_DIST_DIR` s'écrit depuis apps/bot
 * (`../dashboard/dist`) ou depuis la racine du dépôt (`apps/dashboard/dist`).
 * Les chemins attendus se construisent comme ceux du code (le test ne dépend
 * pas du système : barres obliques et racine de lecteur).
 */

const slash = (path: string): string => path.replaceAll('\\', '/');
const BOT = resolve('/', 'repo/apps/bot');
const REPO = resolve(BOT, '..', '..');
const DIST = slash(resolve(REPO, 'apps/dashboard/dist'));
const isDirectory = (path: string): boolean => slash(path) === DIST;

describe('dashboardDirCandidates', () => {
  it('un chemin absolu ne donne que lui-même', () => {
    expect(dashboardDirCandidates('/srv/panel/dist', BOT).map(slash)).toEqual([slash(resolve('/', 'srv/panel/dist'))]);
  });

  it('un chemin relatif est cherché depuis le dossier courant, la racine du dépôt, puis son parent', () => {
    expect(dashboardDirCandidates('dashboard/dist', BOT).map(slash)).toEqual([
      slash(resolve(BOT, 'dashboard/dist')),
      slash(resolve(REPO, 'dashboard/dist')),
      slash(resolve(REPO, 'apps/dashboard/dist')),
    ]);
  });
});

describe('resolveDashboardDir', () => {
  it('sans réglage, rien n\u0027est servi', () => {
    expect(resolveDashboardDir(undefined, BOT, () => true)).toBeNull();
    expect(resolveDashboardDir('   ', BOT, () => true)).toBeNull();
  });

  it.each([
    ['../dashboard/dist', BOT],
    ['apps/dashboard/dist', BOT],
    ['apps/dashboard/dist', REPO],
    [' ../../apps/dashboard/dist ', BOT],
  ])('« %s » lancé depuis %s trouve le dossier', (configured, cwd) => {
    expect(slash(resolveDashboardDir(configured, cwd, isDirectory) ?? '')).toBe(DIST);
  });

  it('un chemin absolu est servi tel quel, existe ou non', () => {
    const elsewhere = slash(resolve('/', 'srv/panel/dist'));
    expect(slash(resolveDashboardDir(elsewhere, BOT, () => false) ?? '')).toBe(elsewhere);
  });

  it('un dossier introuvable garde sa première lecture : les pages répondront 404', () => {
    expect(slash(resolveDashboardDir('nulle/part', BOT, () => false) ?? '')).toBe(slash(resolve(BOT, 'nulle/part')));
  });
});
