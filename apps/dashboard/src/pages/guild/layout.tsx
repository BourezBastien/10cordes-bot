import { Link, Outlet, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ds/button';
import { Page } from '@/shell/page';
import { EVENT_SCOPES, useGuildEvents } from '@/lib/events';
import { ApiError } from '@/lib/api';
import { useGuildSummary } from '@/shell/guild-summary';
import { GuildProvider } from '@/shell/guild-context';

/*
 * COQUE D'UN SERVEUR. Elle lit la fiche du serveur, ouvre le flux temps réel
 * (un événement relit la portée qu'il annonce) et fournit les deux à chaque
 * page. Un serveur refusé (403) ou disparu (404) montre l'écran d'accès
 * refusé plutôt qu'une page qui échoue.
 */

export function isAccessError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404);
}

export function ForbiddenPage() {
  const { t } = useTranslation();
  return (
    <Page>
      <div className="notched notch-danger bg-panel flex flex-col items-start gap-4 p-6">
        <h1 className="text-xl">{t('forbidden.title')}</h1>
        <p className="text-sm text-ink-soft">{t('forbidden.message')}</p>
        <Link to="/guilds">
          <Button size="sm">{t('forbidden.back')}</Button>
        </Link>
      </div>
    </Page>
  );
}

export function GuildLayout() {
  const { guildId } = useParams({ from: '/guilds/$guildId' });
  const queryClient = useQueryClient();
  const summary = useGuildSummary(guildId);
  const live = useGuildEvents(guildId, (type) => {
    void queryClient.invalidateQueries({ queryKey: ['guild', guildId, EVENT_SCOPES[type]] });
    void queryClient.invalidateQueries({ queryKey: ['guild', guildId, 'home'] });
  });

  const data = summary.data;
  const guild = data ? { id: guildId, name: data.name ?? guildId, icon: data.icon, memberCount: data.memberCount ?? 0 } : null;

  return (
    <GuildProvider value={{ guildId, guild, live }}>
      {summary.isError && isAccessError(summary.error) ? <ForbiddenPage /> : <Outlet />}
    </GuildProvider>
  );
}
