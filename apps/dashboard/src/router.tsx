import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, redirect, useLocation } from '@tanstack/react-router';
import { SnowflakeSchema } from '@10cordes/shared';
import { useTranslation } from 'react-i18next';
import { Empty, PageHeader } from '@/ds/kpi';
import { Link } from '@tanstack/react-router';
import { returnPath } from './lib/return-path';
import { GuildLayout } from './pages/guild/layout';
import { GuildsPage } from './pages/guilds';
import { LoginPage } from './pages/login';
import { ErrorBoundary } from './shell/error-boundary';
import { Pending, Page } from './shell/page';
import { requireSession, sessionAlive } from './shell/session';
import { TopBar } from './shell/top-bar';

/*
 * ROUTES. La barre haute habille tout sauf la page de connexion. Les pages
 * de serveurs exigent une session (vérifiée une fois par chargement de
 * page, avant le rendu) ; l'identifiant de la route doit être un identifiant
 * Discord. Le reste de la navigation se fait dans la coque (shell/guild-nav).
 *
 * Chaque page d'un serveur est un morceau à part (lazyRouteComponent) : la
 * connexion et la liste des serveurs ne chargent ni les graphiques ni les
 * formulaires. Le routeur charge le morceau d'une route avant de la rendre.
 */

function RootLayout() {
  const pathname = useLocation({ select: (spot) => spot.pathname });
  return (
    <ErrorBoundary>
      <div className="flex min-h-dvh flex-col">
        {pathname === '/login' ? null : <TopBar />}
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </div>
    </ErrorBoundary>
  );
}

function PendingScreen() {
  const { t } = useTranslation();
  return <Pending label={t('boot.label')} />;
}

function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title="404" description={t('notFound.message')} />
      <Empty
        title={t('notFound.title')}
        action={
          <Link to="/guilds" className="text-badge inline-flex h-[34px] items-center border-2 border-accent bg-accent px-3 text-accent-ink">
            {t('notFound.back')}
          </Link>
        }
      />
    </Page>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  pendingComponent: PendingScreen,
  notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  // L'entrée du panneau mène aux serveurs.
  beforeLoad: () => {
    throw redirect({ to: '/guilds' });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  // Seul un chemin des serveurs est repris comme destination (lib/return-path.ts).
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({ redirect: returnPath(search.redirect) }),
  beforeLoad: async ({ search }) => {
    if (await sessionAlive()) throw redirect({ href: search.redirect ?? '/guilds' });
  },
  component: LoginPage,
});

const guildsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/guilds',
  beforeLoad: requireSession,
  component: GuildsPage,
});

const guildRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/guilds/$guildId',
  beforeLoad: async ({ params }) => {
    await requireSession();
    if (!SnowflakeSchema.safeParse(params.guildId).success) throw redirect({ to: '/guilds' });
  },
  component: GuildLayout,
});

const guildIndexRoute = createRoute({ getParentRoute: () => guildRoute, path: '/', component: lazyRouteComponent(() => import('./pages/guild/home'), 'GuildHomePage') });
const providersRoute = createRoute({ getParentRoute: () => guildRoute, path: 'providers', component: lazyRouteComponent(() => import('./pages/guild/providers'), 'ProvidersPage') });
const integrationsRoute = createRoute({ getParentRoute: () => guildRoute, path: 'integrations', component: lazyRouteComponent(() => import('./pages/guild/integrations'), 'IntegrationsPage') });
const journalRoute = createRoute({ getParentRoute: () => guildRoute, path: 'journal', component: lazyRouteComponent(() => import('./pages/guild/journal'), 'JournalPage') });
const rulesRoute = createRoute({ getParentRoute: () => guildRoute, path: 'rules', component: lazyRouteComponent(() => import('./pages/guild/rules'), 'RulesPage') });
const modulesRoute = createRoute({ getParentRoute: () => guildRoute, path: 'modules', component: lazyRouteComponent(() => import('./pages/guild/modules'), 'ModulesPage') });
const configRoute = createRoute({ getParentRoute: () => guildRoute, path: 'config', component: lazyRouteComponent(() => import('./pages/guild/config'), 'ConfigPage') });
const memoriesRoute = createRoute({ getParentRoute: () => guildRoute, path: 'memories', component: lazyRouteComponent(() => import('./pages/guild/memories'), 'MemoriesPage') });
const systemRoute = createRoute({ getParentRoute: () => guildRoute, path: 'system', component: lazyRouteComponent(() => import('./pages/guild/system'), 'SystemPage') });
const agentRoute = createRoute({ getParentRoute: () => guildRoute, path: 'agent', component: lazyRouteComponent(() => import('./pages/guild/agent'), 'AgentPage') });

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  guildsRoute,
  guildRoute.addChildren([
    guildIndexRoute,
    providersRoute,
    integrationsRoute,
    journalRoute,
    rulesRoute,
    modulesRoute,
    configRoute,
    memoriesRoute,
    systemRoute,
    agentRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
