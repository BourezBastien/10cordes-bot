import { HTTP_METADATA_KEYS, HttpError, ValidationError, type HttpGuard } from '@spraxium/http';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Rig des contrôleurs HTTP : il sert UN contrôleur déjà construit sur une
 * application Hono, comme le framework le fait (préfixe, gardes, then handler),
 * et rend une vraie réponse (statut et corps JSON). Ce que cela prouve : la
 * méthode et le chemin déclarés, les gardes de la route, la liaison des
 * paramètres par décorateur, et l'effet du handler. Ne couvre pas : les
 * middlewares globaux (CORS, journal, politique d'origine).
 */

/** Instance à donner à une garde pour un jeton de son constructeur (`Client`, `PrismaService`...). */
export type GuardDeps = ReadonlyMap<unknown, unknown>;

export interface ApiReply {
  status: number;
  body: Record<string, unknown> | null;
}

interface Route {
  method: string;
  path: string;
  handlerName: string;
}

interface ParamDefinition {
  index: number;
  source: 'param' | 'query' | 'body' | 'header' | 'ctx';
  key?: string;
}

type GuardClass = new (...args: never[]) => HttpGuard;

function routesOf(controller: object): Route[] {
  return Reflect.getMetadata(HTTP_METADATA_KEYS.ROUTES, controller.constructor) ?? [];
}

function guardsOf(controller: object, handlerName: string): GuardClass[] {
  const proto = Object.getPrototypeOf(controller) as object;
  const ofClass: GuardClass[] = Reflect.getMetadata(HTTP_METADATA_KEYS.GUARDS, controller.constructor) ?? [];
  const ofMethod: GuardClass[] = Reflect.getMetadata(HTTP_METADATA_KEYS.GUARDS, proto, handlerName) ?? [];
  return [...ofClass, ...ofMethod];
}

/** Construit une garde par les jetons de son constructeur, comme le registre du framework. */
function instantiate<T>(cls: new (...args: never[]) => T, deps: GuardDeps): T {
  const types: unknown[] = Reflect.getMetadata('design:paramtypes', cls) ?? [];
  return new cls(...(types.map((token) => deps.get(token)) as never[]));
}

/** Arguments du handler, par décorateur ; un corps qui n'est pas du JSON vaut 400, comme en production. */
async function argsOf(controller: object, handlerName: string, ctx: Context): Promise<unknown[]> {
  const proto = Object.getPrototypeOf(controller) as object;
  const definitions: ParamDefinition[] = Reflect.getMetadata(HTTP_METADATA_KEYS.PARAMS, proto, handlerName) ?? [];
  if (definitions.length === 0) return [ctx];
  const args: unknown[] = new Array(Math.max(...definitions.map((definition) => definition.index)) + 1);
  let body: unknown;
  for (const definition of definitions) {
    switch (definition.source) {
      case 'param':
        args[definition.index] = definition.key ? ctx.req.param(definition.key) : ctx.req.param();
        break;
      case 'query':
        args[definition.index] = definition.key ? ctx.req.query(definition.key) : ctx.req.query();
        break;
      case 'body':
        body ??= await ctx.req.json().catch(() => {
          throw new ValidationError([{ property: 'body', constraints: { json: 'Body is not valid JSON.' } }]);
        });
        args[definition.index] = body;
        break;
      case 'header':
        args[definition.index] = definition.key ? ctx.req.header(definition.key) : ctx.req.header();
        break;
      case 'ctx':
        args[definition.index] = ctx;
        break;
    }
  }
  return args;
}

export function apiHarness(deps: GuardDeps) {
  /** Chaque route déclarée reçoit ses gardes puis son handler ; un bug remonte au test, pas en 500 avalé. */
  function serve(controller: object): Hono {
    const app = new Hono();
    const prefix: string = Reflect.getMetadata(HTTP_METADATA_KEYS.PREFIX, controller.constructor) ?? '/';
    for (const route of routesOf(controller)) {
      const handler = (controller as Record<string, unknown>)[route.handlerName];
      if (typeof handler !== 'function') continue;
      const guards = guardsOf(controller, route.handlerName).map((guard) => instantiate(guard, deps));
      app.on(route.method, [prefix + route.path], async (ctx) => {
        for (const guard of guards) {
          if (!(await guard.canActivate(ctx))) return ctx.json({ ok: false, error: 'Unauthorized' }, 401);
        }
        const result: unknown = await handler.apply(controller, await argsOf(controller, route.handlerName, ctx));
        return result instanceof Response ? result : ctx.json(result);
      });
    }
    app.onError((error, ctx) => {
      if (error instanceof ValidationError) return ctx.json({ ok: false, error: error.message, details: error.details }, 400);
      if (error instanceof HttpError) return ctx.json({ ok: false, error: error.message }, error.statusCode as ContentfulStatusCode);
      throw error;
    });
    return app;
  }

  return { serve };
}

/** Une requête au rig ; `body` est sérialisée en JSON quand elle est donnée. */
export async function request(app: Hono, method: string, path: string, body?: unknown): Promise<ApiReply> {
  const response = await app.request(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

/** Les routes déclarées d'un contrôleur : méthode, chemin complet, gardes. */
export function declaredRoutes(controller: object, guards: readonly unknown[]): Array<{ method: string; path: string; handler: string; guards: boolean }> {
  const prefix: string = Reflect.getMetadata(HTTP_METADATA_KEYS.PREFIX, controller.constructor) ?? '/';
  return routesOf(controller).map((route) => ({
    method: route.method,
    path: prefix + route.path,
    handler: route.handlerName,
    guards: guardsOf(controller, route.handlerName).every((guard, index) => guard === guards[index]),
  }));
}
