import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/ds/avatar';
import { Brand } from '@/ds/brand';
import { Select, type SelectOption } from '@/ds/select';
import { currentLocale, toggleLocale, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useGuildList } from './guild-list';
import { useGuildSummary } from './guild-summary';
import { GUILD_PAGES } from './guild-nav';
import { useSearchHotkey } from './hotkey';
import { MorePanel } from './more-panel';
import { GuildPageLink, MobileBar, MoreButton, SearchButton, UserBlock, usePageActive } from './nav-parts';
import { SearchPalette, type Destination } from './search-palette';

/*
 * BARRE HAUTE (56 px, fixée en haut). De gauche à droite : la marque, le
 * sélecteur de serveur (1280 px et plus), les pages du serveur (une ligne
 * défilante, barre d'accent sous la page ouverte), la recherche, le bouton
 * « Plus » (sous 1280 px), puis la langue, l'avatar et la déconnexion. Sous
 * 768 px les pages passent dans le menu « Plus » et dans quatre cases fixes
 * en bas de l'écran. La barre ouvre la palette (`/`) et le menu « Plus ».
 */

const GUILD_PREFIX = /^\/guilds\/[^/]+/u;

interface GuildOptionValue {
  value: string;
  text: string;
  label: ReactNode;
}

export function TopBar() {
  const { t } = useTranslation();
  const { guildId } = useParams({ strict: false });
  const id = typeof guildId === 'string' ? guildId : null;
  const pathname = useLocation({ select: (spot) => spot.pathname });
  const router = useRouter();
  const pageActive = usePageActive();
  const guilds = useGuildList();
  const summary = useGuildSummary(id);
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  useSearchHotkey(() => setPalette(true));

  const go = useCallback((href: string) => void router.navigate({ href }), [router]);
  const other: Locale = currentLocale() === 'fr' ? 'en' : 'fr';

  const destinations = useMemo<Destination[]>(() => {
    const pages: Destination[] = id
      ? GUILD_PAGES.map((page) => ({
          key: page.id,
          group: 'pages' as const,
          label: t(page.label),
          go: () => go(`/guilds/${id}${page.id === 'home' ? '' : `/${page.id}`}`),
        }))
      : [{ key: 'servers', group: 'pages', label: t('nav.servers'), hint: '/guilds', go: () => go('/guilds') }];
    const servers: Destination[] = (guilds.data?.guilds ?? []).map((guild) => ({
      key: `guild-${guild.id}`,
      group: 'servers' as const,
      label: guild.name,
      go: () => go(`/guilds/${guild.id}`),
    }));
    return [...pages, ...servers];
  }, [id, guilds.data, go, t]);

  const switchOptions = useMemo<SelectOption<string>[]>(() => {
    const list = guilds.data?.guilds ?? [];
    const options: GuildOptionValue[] = list.map((guild) => ({
      value: guild.id,
      text: guild.name,
      label: (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={guild.name} src={guild.icon} size={20} />
          <span className="truncate">{guild.name}</span>
        </span>
      ),
    }));
    // Le serveur affiché sans fiche (lecture en cours) : une option au nom lu dans l'URL.
    if (id && !list.some((guild) => guild.id === id) && summary.data?.name) {
      options.unshift({ value: id, text: summary.data.name, label: summary.data.name });
    }
    return options;
  }, [guilds.data, id, summary.data]);

  const switcher =
    id && switchOptions.length > 0 ? (
      <Select
        aria-label={t('common.server')}
        size="sm"
        className="w-full max-w-60"
        value={id}
        options={switchOptions}
        onChange={(next) => go(pathname.replace(GUILD_PREFIX, `/guilds/${next}`))}
      />
    ) : null;

  const userBlock = <UserBlock onLocale={toggleLocale} other={other} />;

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-stretch gap-2 border-b-2 border-line bg-panel-deep px-3 md:px-5">
        <Link to="/guilds" aria-label={t('nav.servers')} className="flex h-14 shrink-0 items-center">
          <Brand />
        </Link>
        {id ? (
          <>
            <div className="hidden w-64 shrink-0 items-center xl:flex">{switcher}</div>
            <nav
              aria-label={t('common.server')}
              className="hidden min-w-0 flex-1 items-stretch overflow-x-auto md:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {GUILD_PAGES.map((page) => (
                <GuildPageLink key={page.id} page={page} active={pageActive(page)} />
              ))}
            </nav>
            <span className="flex-1 md:hidden" />
          </>
        ) : (
          <span className="flex-1" />
        )}
        <span className="flex shrink-0 items-center gap-1">
          <SearchButton onClick={() => setPalette(true)} />
          {id ? <MoreButton onClick={() => setMore(true)} className="xl:hidden" /> : null}
          {userBlock}
        </span>
      </header>
      <SearchPalette open={palette} onOpenChange={setPalette} destinations={destinations} />
      <MorePanel
        open={more}
        onOpenChange={setMore}
        switcher={switcher}
        pages={(close) => (
          <ul className="grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3">
            {GUILD_PAGES.map((page) => {
              const active = pageActive(page);
              return (
                <li key={page.id} className={cn(active && 'bar-accent')}>
                  <Link
                    to={page.to}
                    params={{ guildId: id ?? '' }}
                    onClick={close}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'block h-12 border-2 px-3 leading-11 font-pixel text-[11px] tracking-wide whitespace-nowrap uppercase select-none',
                      active ? 'border-accent text-accent-soft' : 'border-line text-ink-muted hover:border-edge hover:text-ink',
                    )}
                  >
                    {t(page.label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        footer={userBlock}
      />
      {id ? <MobileBar /> : null}
    </>
  );
}
