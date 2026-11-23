/**
 * Accès runtime au rendu des surfaces, pour les contextes hors DI (registry).
 *
 * Lié au boot de SurfaceService (provider). Il ne doit JAMAIS être lié dans
 * une classe de module : le framework n'instancie pas les modules, seulement
 * leurs providers/listeners/handlers. Un onBoot de module ne s'exécute pas.
 */
export interface SurfaceRuntime {
  render: (surfaceId: string) => Promise<void>;
}

let runtime: SurfaceRuntime | null = null;

export function bindSurfaceRuntime(value: SurfaceRuntime): void {
  runtime = value;
}

export function getSurfaceRuntime(): SurfaceRuntime | null {
  return runtime;
}
