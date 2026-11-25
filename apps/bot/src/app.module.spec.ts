import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { METADATA_KEYS } from '@spraxium/common';
import { HTTP_METADATA_KEYS } from '@spraxium/http';
import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { SessionGuard } from './auth/guards/session.guard';
import { GuildAccessGuard } from './auth/guards/guild-access.guard';
import { ProbeKeyGuard } from './auth/guards/probe-key.guard';
import { ApiPolicyMiddleware } from './modules/api/api-policy.middleware';
import { httpSecurity } from './modules/api/http-security';
import { PanelController } from './modules/api/panel.controller';

/**
 * Invariants du module racine, lus dans les métadonnées des décorateurs (ce
 * que le serveur HTTP du framework enregistre) : l’ordre des contrôleurs
 * (c’est l’ordre des routes, et le panel fourre-tout doit rester le dernier),
 * les gardes de chaque famille de routes, et les jetons d’injection. Un jeton
 * muet (`Object`) vient d’un type importé par `import type` ou d’un argument à
 * valeur par défaut : le framework construit alors la classe SANS sa
 * dépendance, sans un mot.
 */

type Controller = new (...args: never[]) => unknown;

interface RouteMetadata {
  method: string;
  path: string;
  handlerName: string;
}

// Clé des métadonnées de module du framework (la même que lit le chargeur).
const MODULE_KEY = METADATA_KEYS.MODULE;

const http = Reflect.getMetadata(HTTP_METADATA_KEYS.HTTP_CLIENT_MODULE, AppModule) as { controllers: Controller[]; middleware: unknown[] };
const moduleMetadata = Reflect.getMetadata(MODULE_KEY, AppModule) as { providers: Controller[]; imports: unknown[] };

function guardsOf(controller: Controller, handlerName?: string): unknown[] {
  const ofClass: unknown[] = Reflect.getMetadata(HTTP_METADATA_KEYS.GUARDS, controller) ?? [];
  const ofMethod = handlerName ? (Reflect.getMetadata(HTTP_METADATA_KEYS.GUARDS, controller.prototype, handlerName) ?? []) : [];
  return [...ofClass, ...ofMethod];
}

function routesOf(controller: Controller): RouteMetadata[] {
  return Reflect.getMetadata(HTTP_METADATA_KEYS.ROUTES, controller) ?? [];
}

function prefixOf(controller: Controller): string {
  return Reflect.getMetadata(HTTP_METADATA_KEYS.PREFIX, controller) ?? '/';
}

/** Aucun jeton de constructeur n’est muet (undefined, ou Object). */
function expectResolvableTokens(target: Function, label: string): void {
  for (const token of (Reflect.getMetadata('design:paramtypes', target) ?? []) as unknown[]) {
    expect(token, label).toBeDefined();
    expect(token, label).not.toBe(Object);
    expect(typeof token, label).toBe('function');
  }
}

describe('AppModule · contrôleurs HTTP', () => {
  it('le panel fourre-tout à la racine est déclaré en DERNIER : aucune route d’API ne peut tomber dedans', () => {
    const controllers = http.controllers;
    expect(controllers.at(-1)).toBe(PanelController);
    const panelIndex = controllers.indexOf(PanelController);
    // D’autres routes fourre-tout existent (la connexion), mais jamais à la racine : elles ne couvrent que leur préfixe.
    for (const controller of controllers) {
      const catchAll = routesOf(controller).some((route) => route.path === '/*');
      if (!catchAll) continue;
      if (controller !== PanelController) expect(prefixOf(controller), controller.name).not.toBe('');
      expect(controllers.indexOf(controller), controller.name).toBeLessThanOrEqual(panelIndex);
    }
    // Toute route d’API est déclarée avant le panel.
    for (const controller of controllers) {
      if (controller === PanelController) continue;
      expect(controllers.indexOf(controller), controller.name).toBeLessThan(panelIndex);
    }
  });

  it('toute route d’un serveur exige la session puis l’accès à ce serveur ; la liste des serveurs, la session seule', () => {
    const guildControllers = http.controllers.filter((controller) => prefixOf(controller) === '/api/v1/guilds');
    expect(guildControllers.map((controller) => controller.name).sort()).toEqual(
      [
        'AgentSettingsController',
        'CapabilitiesController',
        'EventsController',
        'GuildsController',
        'IntegrationsController',
        'ProvidersController',
        'RulesController',
        'UsageController',
        'WebhooksController',
      ].sort(),
    );
    let routes = 0;
    let guarded = 0;
    for (const controller of guildControllers) {
      const declared = routesOf(controller);
      expect(declared.length, controller.name).toBeGreaterThan(0);
      for (const route of declared) {
        routes += 1;
        const name = `${controller.name}.${route.handlerName} (${route.method} ${route.path})`;
        expect(guardsOf(controller, route.handlerName)[0], name).toBe(SessionGuard);
        if (!route.path.includes(':guildId')) continue;
        guarded += 1;
        expect(guardsOf(controller, route.handlerName), name).toEqual([SessionGuard, GuildAccessGuard]);
      }
    }
    expect(routes).toBeGreaterThan(30);
    // Seuls deux enregistrements de ce préfixe ne ciblent pas un serveur : la liste, avec et sans barre finale.
    expect(routes - guarded).toBe(2);
  });

  it('la CSP n’a qu’un maître : le framework ne pose plus la sienne, et le middleware de politique est dans la chaîne', () => {
    // Le framework écrase la CSP de chaque réponse après le handler, avec une seule valeur pour toutes :
    // laissée active, elle interdit au panel compilé ses scripts, ses styles et ses polices.
    expect(httpSecurity('https://panel.exemple.test').headers).toEqual({ contentSecurityPolicy: false });
    // La configuration du serveur lui passe la main (elle vit hors du répertoire des sources : son texte est lu).
    const config = readFileSync(fileURLToPath(new URL('../config/http.config.ts', import.meta.url)), 'utf8');
    expect(config).toContain('security: httpSecurity(');
    expect(config).not.toMatch(/contentSecurityPolicy:\s*['"]/u);
    expect(http.middleware).toEqual(expect.arrayContaining([expect.any(ApiPolicyMiddleware)]));
  });

  it('la garde d’accès à un serveur n’apparaît jamais sans la session devant elle', () => {
    for (const controller of http.controllers) {
      for (const route of routesOf(controller)) {
        const guards = guardsOf(controller, route.handlerName);
        if (!guards.includes(GuildAccessGuard)) continue;
        expect(guards[0], `${controller.name}.${route.handlerName}`).toBe(SessionGuard);
      }
    }
  });

  it('la sonde demande la clé serveur à serveur ; les pages publiques n’ont aucune garde', () => {
    const probe = http.controllers.find((controller) => controller.name === 'HealthController');
    expect(probe).toBeDefined();
    for (const route of routesOf(probe as Controller)) expect(guardsOf(probe as Controller, route.handlerName)).toEqual([ProbeKeyGuard]);
    for (const name of ['PanelController', 'LegalController', 'AuthController']) {
      const controller = http.controllers.find((candidate) => candidate.name === name);
      expect(controller, name).toBeDefined();
      for (const route of routesOf(controller as Controller)) expect(guardsOf(controller as Controller, route.handlerName), `${name}.${route.handlerName}`).toEqual([]);
    }
  });

  it('chaque contrôleur HTTP est aussi un fournisseur du module racine (le serveur le construit dans le conteneur racine)', () => {
    for (const controller of http.controllers) {
      expect(moduleMetadata.providers, controller.name).toContain(controller);
    }
  });

  it('aucun contrôleur ni aucune garde n’a de jeton de constructeur muet', () => {
    for (const target of [...http.controllers, SessionGuard, GuildAccessGuard, ProbeKeyGuard]) expectResolvableTokens(target, target.name);
  });

  it('aucun fournisseur d’aucun module de l’application n’a de jeton de constructeur muet', () => {
    // Tout le graphe : le module racine, ses imports, et les leurs.
    const seen = new Set<Function>();
    const stack: Function[] = [AppModule];
    const checked: string[] = [];
    while (stack.length > 0) {
      const target = stack.pop() as Function;
      if (seen.has(target)) continue;
      seen.add(target);
      const metadata = Reflect.getMetadata(MODULE_KEY, target) as { providers?: unknown[]; imports?: unknown[] } | undefined;
      for (const provider of metadata?.providers ?? []) {
        if (typeof provider !== 'function') continue;
        checked.push(provider.name);
        expectResolvableTokens(provider, `fournisseur ${provider.name} (${target.name})`);
      }
      for (const imported of metadata?.imports ?? []) if (typeof imported === 'function') stack.push(imported);
    }
    expect(seen.size).toBeGreaterThan(20);
    expect(checked.length).toBeGreaterThan(60);
    expect(checked).toEqual(expect.arrayContaining(['DashboardEventsService', 'UsageLogService', 'WebhookEndpointService', 'ProviderHealthService']));
  });
});
