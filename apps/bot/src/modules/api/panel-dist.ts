import { isAbsolute, resolve } from 'node:path';

/*
 * DOSSIER DU PANEL COMPILÉ. `DASHBOARD_DIST_DIR` s'écrit depuis l'endroit d'où
 * le bot est lancé (`apps/bot` : `../dashboard/dist`) ou depuis la racine du
 * dépôt (`apps/dashboard/dist`). Les deux se valent : le dossier est cherché
 * à ces trois endroits, le premier qui existe l'emporte.
 */

/** Où le dossier relatif est cherché, dans l'ordre : le dossier courant, la racine du dépôt, puis le dossier parent. */
export function dashboardDirCandidates(configured: string, cwd: string): string[] {
  const dir = configured.trim();
  if (dir === '') return [];
  if (isAbsolute(dir)) return [resolve(dir)];
  return [resolve(cwd, dir), resolve(cwd, '..', '..', dir), resolve(cwd, '..', dir)];
}

/**
 * Le dossier du panel compilé, ou null sans réglage. Un chemin relatif qui ne
 * existe à aucun endroit garde sa première lecture : les pages répondront 404,
 * comme un dossier vide.
 */
export function resolveDashboardDir(configured: string | undefined, cwd: string, isDirectory: (path: string) => boolean): string | null {
  const candidates = dashboardDirCandidates(configured ?? '', cwd);
  if (candidates.length === 0) return null;
  return candidates.find((candidate) => isDirectory(candidate)) ?? candidates[0] ?? null;
}
