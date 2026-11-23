import { Link, Outlet, useMatchRoute, useParams } from '@tanstack/react-router';
import { Home, Settings, Puzzle, ScrollText, Brain, BarChart3, MessageSquare, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate } from '@tanstack/react-router';
import { useSession, authClient } from '@/lib/auth';
import { cn } from '@/lib/utils';

const items = [
  { to: '/g/$guildId', icon: Home, key: 'nav.home' },
  { to: '/g/$guildId/config', icon: Settings, key: 'nav.config' },
  { to: '/g/$guildId/modules', icon: Puzzle, key: 'nav.modules' },
  { to: '/g/$guildId/audit', icon: ScrollText, key: 'nav.audit' },
  { to: '/g/$guildId/memories', icon: Brain, key: 'nav.memories' },
  { to: '/g/$guildId/stats', icon: BarChart3, key: 'nav.stats' },
  { to: '/g/$guildId/agent', icon: MessageSquare, key: 'nav.agent' },
] as const;

export function GuildLayout() {
  const { t } = useTranslation();
  const { data: session, isPending } = useSession();
  const matchRoute = useMatchRoute();
  const { guildId } = useParams({ from: '/g/$guildId' });

  if (isPending) {
    return <div className="grid h-full place-items-center text-ink-muted">{t('common.loading')}</div>;
  }
  if (!session) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-56 flex-col border-r border-line bg-surface">
        <div className="border-b border-line p-4">
          <span className="text-lg font-bold text-accent">10cordes</span>
        </div>
        <nav className="flex-1 p-2">
          {items.map((item) => {
            const active = Boolean(matchRoute({ to: item.to, params: { guildId }, fuzzy: true }));
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                to={item.to}
                params={{ guildId }}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  active ? 'bg-surface-hover font-medium text-ink' : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
                )}
              >
                <Icon size={16} />
                {t(item.key)}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line p-2">
          <button
            type="button"
            onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => window.location.assign('/login') } })}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <LogOut size={16} />
            {t('nav.logout')}
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-canvas">
        <Outlet />
      </main>
    </div>
  );
}
