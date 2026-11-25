import { METADATA_KEYS } from '@spraxium/common';
import { HTTP_METADATA_KEYS } from '@spraxium/http';
import { Client } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { AppEnv } from './app.env';
import { AppModule } from './app.module';

/**
 * La portée d’injection, rejouée comme le fait le framework au démarrage.
 *
 * Les modules d’abord (`ModuleLoader.loadModule`). Un fournisseur ne voit que
 * son conteneur : ses propres fournisseurs déjà construits, les exports des
 * modules qu’il importe, et ce que le conteneur racine contient À CE MOMENT
 * (ce que `main.ts` fournit, les modules globaux déjà chargés). Un fournisseur
 * du module racine n’appartient à personne d’autre.
 *
 * Les contrôleurs HTTP ensuite, que le serveur construit dans le conteneur
 * RACINE, et sans refuser : un paramètre qui n’y est pas arrive `undefined` au
 * constructeur, sans un mot.
 *
 * Les specs qui montent un service à la main, avec des leurres, ne voient rien
 * de tout cela. Le 25/11/2026, la CI était verte et le bot refusait de
 * démarrer (« cannot resolve dependency for WebAgentService ») ; une fois ce
 * défaut levé, sa sonde répondait 500 (« reading 'isDraining' »).
 */

type Constructor = new (...args: never[]) => unknown;
type Token = unknown;

interface ModuleMetadata {
  imports?: unknown[];
  providers?: unknown[];
  listeners?: unknown[];
  handlers?: unknown[];
  exports?: unknown[];
}

interface RouteMetadata {
  handlerName: string;
}

/** Un conteneur : ce qu’il contient, et son parent. */
class Scope {
  readonly own = new Set<unknown>();

  constructor(readonly parent: Scope | null) {}

  has(token: unknown): boolean {
    return this.own.has(token) || (this.parent?.has(token) ?? false);
  }
}

/** Jetons des paramètres du constructeur d’une classe, `@Inject` compris. */
function tokensOf(target: Function): Token[] {
  const inject = Reflect.getOwnMetadata(METADATA_KEYS.INJECT, target) as Map<number, Token> | undefined;
  const types = (Reflect.getMetadata('design:paramtypes', target) ?? []) as Token[];
  return types.map((type, index) => inject?.get(index) ?? type);
}

/** Ce que le chargeur de modules refuse : un paramètre requis, absent du conteneur. */
function requiredMissing(target: Function, scope: Scope): Array<{ index: number; token: Token }> {
  const optional = Reflect.getOwnMetadata(METADATA_KEYS.OPTIONAL, target) as Set<number> | undefined;
  return tokensOf(target)
    .map((token, index) => ({ index, token }))
    .filter(({ index, token }) => !optional?.has(index) && !scope.has(token));
}

const nameOf = (token: Token): string => (typeof token === 'function' ? token.name : String(token));

/** L’ordre où le chargeur instancie les fournisseurs d’un module : un tri par dépendances entre eux (`sortProviders`). */
function orderedProviders(providers: Function[], scope: Scope): Function[] {
  if (providers.length <= 1) return providers;
  const indexOf = new Map(providers.map((provider, index) => [provider, index]));
  const dependents: number[][] = providers.map(() => []);
  const inDegree = providers.map(() => 0);
  providers.forEach((provider, consumer) => {
    for (const token of tokensOf(provider)) {
      const dependency = indexOf.get(token as Function);
      // Seule compte une dépendance qui est un autre fournisseur du module et que le conteneur ne connaît pas déjà.
      if (dependency !== undefined && !scope.has(token)) {
        dependents[dependency]?.push(consumer);
        inDegree[consumer] += 1;
      }
    }
  });
  const queue = providers.map((_provider, index) => index).filter((index) => inDegree[index] === 0);
  const sorted: Function[] = [];
  while (queue.length > 0) {
    const index = queue.shift() as number;
    sorted.push(providers[index] as Function);
    for (const dependent of dependents[index] ?? []) {
      if (--inDegree[dependent] === 0) queue.push(dependent);
    }
  }
  expect(sorted.length, 'dépendance circulaire entre les fournisseurs').toBe(providers.length);
  return sorted;
}

/** Charge tout le graphe comme le fait le framework ; rend le conteneur racine et ce que le chargeur a refusé. */
function loadGraph(): { root: Scope; loaded: Set<Function>; refused: string[] } {
  const root = new Scope(null);
  // Ce que le framework et `main.ts` posent dans le conteneur racine avant tout module.
  for (const token of [Client, AppEnv]) root.own.add(token);

  const refused: string[] = [];
  const loaded = new Set<Function>();
  const visit = (module: Function, parentScope: Scope): void => {
    // Un module déjà chargé n'est pas rechargé, et n'exporte une seconde fois nulle part.
    if (loaded.has(module)) return;
    loaded.add(module);
    const metadata = Reflect.getOwnMetadata(METADATA_KEYS.MODULE, module) as ModuleMetadata | undefined;
    const isGlobal = Reflect.getOwnMetadata(METADATA_KEYS.GLOBAL, module) === true;
    const scope = isGlobal ? root : new Scope(parentScope);
    for (const imported of metadata?.imports ?? []) {
      if (typeof imported === 'function') visit(imported, scope);
    }
    const instantiate = (target: unknown, kind: string): void => {
      if (typeof target !== 'function') return;
      for (const { index, token } of requiredMissing(target, scope)) {
        refused.push(`${module.name} · ${kind} ${target.name} ← paramètre ${index} (${nameOf(token)}) : ni fourni par ${module.name}, ni exporté par un module qu'il importe, ni dans le conteneur racine à ce moment`);
      }
      scope.own.add(target);
    };
    const providers = (metadata?.providers ?? []).filter((provider): provider is Function => typeof provider === 'function');
    for (const provider of orderedProviders(providers, scope)) instantiate(provider, 'fournisseur');
    for (const listener of metadata?.listeners ?? []) instantiate(listener, 'écouteur');
    for (const handler of metadata?.handlers ?? []) instantiate(handler, 'handler');
    // Les exports d'un module global vont à la racine ; ceux d'un autre, à son importateur.
    const exportTarget = isGlobal ? root : parentScope;
    for (const exported of metadata?.exports ?? []) {
      if (scope.has(exported)) exportTarget.own.add(exported);
    }
  };
  visit(AppModule, root);
  return { root, loaded, refused };
}

const routesOf = (controller: Constructor): RouteMetadata[] => Reflect.getMetadata(HTTP_METADATA_KEYS.ROUTES, controller) ?? [];

/** Les gardes d’une route : celles de la classe, puis celles de la méthode. */
function guardsOf(controller: Constructor, handlerName?: string): unknown[] {
  const ofClass: unknown[] = Reflect.getMetadata(HTTP_METADATA_KEYS.GUARDS, controller) ?? [];
  const ofMethod = handlerName ? (Reflect.getMetadata(HTTP_METADATA_KEYS.GUARDS, controller.prototype, handlerName) ?? []) : [];
  return [...ofClass, ...ofMethod];
}

describe('portée d’injection du graphe de modules', () => {
  it('chaque dépendance d’un fournisseur, d’un écouteur ou d’un handler est résoluble dans la portée de son module, au moment où le framework l’instanche', () => {
    const { loaded, refused } = loadGraph();
    expect(loaded.size).toBeGreaterThan(25);
    expect(refused).toEqual([]);
  });

  it('chaque contrôleur HTTP et chaque garde résout toutes ses dépendances dans le conteneur racine, où le serveur les construit', () => {
    const { root } = loadGraph();
    const http = Reflect.getMetadata(HTTP_METADATA_KEYS.HTTP_CLIENT_MODULE, AppModule) as { controllers: Constructor[] };
    const unresolved: string[] = [];
    const check = (target: unknown, label: string): void => {
      if (typeof target !== 'function') return;
      // Le serveur ne refuse rien : un paramètre absent arrive `undefined` au constructeur.
      for (const [index, token] of tokensOf(target).entries()) {
        if (root.has(token)) continue;
        unresolved.push(`${label} ← paramètre ${index} (${nameOf(token)}) : absent du conteneur racine (un fournisseur du module racine ou d'un module non global n'y est jamais)`);
      }
    };
    for (const controller of http.controllers) {
      check(controller, `contrôleur ${controller.name}`);
      for (const route of routesOf(controller)) {
        for (const guard of guardsOf(controller, route.handlerName)) check(guard, `garde de ${controller.name}.${route.handlerName}`);
      }
    }
    expect(http.controllers.length).toBeGreaterThan(10);
    expect(unresolved).toEqual([]);
  });
});
