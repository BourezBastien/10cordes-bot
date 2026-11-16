import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { LoginPage } from './pages/login';
import { GuildsPage } from './pages/guilds';
import { GuildLayout } from './pages/guild/layout';
import { GuildHomePage } from './pages/guild/home';
import { ConfigPage } from './pages/guild/config';
import { ModulesPage } from './pages/guild/modules';
import { AuditPage } from './pages/guild/audit';
import { MemoriesPage } from './pages/guild/memories';
import { StatsPage } from './pages/guild/stats';
import { AgentPage } from './pages/guild/agent';

const rootRoute = createRootRoute({ component: Outlet });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    window.location.replace('/guilds');
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const guildsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/guilds',
  component: GuildsPage,
});

const guildLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/g/$guildId',
  component: GuildLayout,
});

const guildIndexRoute = createRoute({
  getParentRoute: () => guildLayoutRoute,
  path: '/',
  component: GuildHomePage,
});

const configRoute = createRoute({
  getParentRoute: () => guildLayoutRoute,
  path: 'config',
  component: ConfigPage,
});

const modulesRoute = createRoute({
  getParentRoute: () => guildLayoutRoute,
  path: 'modules',
  component: ModulesPage,
});

const auditRoute = createRoute({
  getParentRoute: () => guildLayoutRoute,
  path: 'audit',
  component: AuditPage,
});

const memoriesRoute = createRoute({
  getParentRoute: () => guildLayoutRoute,
  path: 'memories',
  component: MemoriesPage,
});

const statsRoute = createRoute({
  getParentRoute: () => guildLayoutRoute,
  path: 'stats',
  component: StatsPage,
});

const agentRoute = createRoute({
  getParentRoute: () => guildLayoutRoute,
  path: 'agent',
  component: AgentPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  guildsRoute,
  guildLayoutRoute.addChildren([
    guildIndexRoute,
    configRoute,
    modulesRoute,
    auditRoute,
    memoriesRoute,
    statsRoute,
    agentRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
