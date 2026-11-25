import { Link, useMatchRoute, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Cpu, Home, LogOut, Menu, Plug, ScrollText, type LucideIcon } from 'lucide-react';
import { Avatar } from '@/ds/avatar';
import { useSession } from '@/lib/auth';
import { GUILD_PAGES, GUILD_TILES } from './guild-nav';
import { signOut } from './session';
import { cn } from '@/lib/utils';

/*
 * MORCEAUX DE LA BARRE HAUTE : le lien d'une page, les quatre cases de la
 * barre basse mobile, le bloc de l'utilisateur (langue, avatar, déconnexion),
 * le bouton « Plus » et le bouton de recherche.
 */

const TILE_ICON: Record<string, LucideIcon> = {
  home: Home,
  providers: Cpu,
  integrations: Plug,
  journal: ScrollText,
};

export function usePageActive(): (page: (typeof GUILD_PAGES)[number]) => boolean {
  const { guildId } = useParams({ strict: false });
  const matchRoute = useMatchRoute();
  const id = String(guildId);
  return (page) => Boolean(matchRoute({ to: page.to, params: { guildId: id }, fuzzy: page.id !== 'home' }));
}

/** Le lien d'une page du serveur dans la barre haute : barre d'accent sous la page ouverte. */
export function GuildPageLink({ page, active, onClick }: { page: (typeof GUILD_PAGES)[number]; active: boolean; onClick?: () => void }) {
  const { t } = useTranslation();
  const { guildId } = useParams({ strict: false });
  return (
    <Link
      to={page.to}
      params={{ guildId: String(guildId) }}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-14 shrink-0 items-center border-b-[3px] px-3 font-pixel text-[11px] tracking-wide whitespace-nowrap uppercase select-none enabled:active:translate-y-px',
        active ? 'border-accent text-accent-soft' : 'border-transparent text-ink-muted hover:bg-hover hover:text-ink',
      )}
    >
      {t(page.label)}
    </Link>
  );
}

/** Quatre cases fixes en bas de l'écran, sous 768 px. */
export function MobileBar() {
  const { t } = useTranslation();
  const { guildId } = useParams({ strict: false });
  const id = String(guildId);
  const matchRoute = useMatchRoute();
  return (
    <nav
      aria-label={t('nav.more')}
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t-2 border-line bg-panel-deep pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {GUILD_TILES.map((page) => {
        const active = Boolean(matchRoute({ to: page.to, params: { guildId: id }, fuzzy: page.id !== 'home' }));
        const Icon = TILE_ICON[page.id] ?? Home;
        return (
          <Link
            key={page.id}
            to={page.to}
            params={{ guildId: id }}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mt-0.5 flex h-16 flex-col items-center justify-center gap-1.5 border-t-[3px] px-1 select-none',
              active ? 'border-accent text-accent-soft' : 'border-transparent text-ink-muted',
            )}
          >
            <Icon size={18} strokeWidth={1.75} aria-hidden />
            <span className="text-badge">{t(page.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function UserBlock({ onLocale, other }: { onLocale: () => void; other: string }) {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const user = session?.user;
  return (
    <span className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onLocale}
        aria-label={`${t('nav.locale')} : ${other.toUpperCase()}`}
        title={t('nav.locale')}
        className="h-11 border-2 border-transparent px-2 font-pixel text-[11px] text-ink-muted hover:border-edge hover:text-ink enabled:active:translate-y-px"
      >
        {other.toUpperCase()}
      </button>
      {user ? (
        <span className="hidden h-11 items-center sm:inline-flex" title={t('shell.signedInAs', { name: user.name ?? '' })}>
          <Avatar name={user.name ?? t('shell.guest')} src={user.image ?? null} size={32} />
        </span>
      ) : null}
      <button
        type="button"
        onClick={signOut}
        aria-label={t('nav.logout')}
        title={t('nav.logout')}
        className="grid h-11 w-11 place-items-center border-2 border-transparent text-ink-muted hover:border-edge hover:text-ink enabled:active:translate-y-px"
      >
        <LogOut size={16} strokeWidth={2} aria-hidden />
      </button>
    </span>
  );
}

export function MoreButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('nav.more')}
      aria-haspopup="dialog"
      className={cn(
        'grid h-11 w-11 shrink-0 place-items-center border-2 border-edge bg-panel text-ink hover:bg-hover enabled:active:translate-y-px',
        className,
      )}
    >
      <Menu size={18} strokeWidth={2} aria-hidden />
    </button>
  );
}

/** Bouton de recherche : la touche elle-même, encadrée. */
export function SearchButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('nav.search')}
      aria-keyshortcuts="/ Control+k Meta+k"
      title={t('nav.search')}
      className={cn(
        'hidden h-11 w-11 shrink-0 place-items-center border-2 border-edge bg-panel font-pixel text-xs text-ink-soft hover:bg-hover md:grid',
        className,
      )}
    >
      /
    </button>
  );
}
