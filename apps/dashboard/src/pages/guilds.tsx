import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/ds/avatar';
import { CardList } from '@/ds/card-list';
import { Empty, PageHeader } from '@/ds/kpi';
import { useGuildList } from '@/shell/guild-list';
import { Page, QueryState } from '@/shell/page';

/*
 * SERVEURS. Les serveurs où le bot est présent et où le compte connecté peut
 * le configurer. Neuf cartes d'abord ; une carte mène à l'accueil du
 * serveur. L'icône vient de l'API sous forme d'URL complète : à défaut, ou
 * si elle est refusée, l'initiale du nom.
 */

export function GuildsPage() {
  const { t } = useTranslation();
  const guilds = useGuildList();

  return (
    <Page>
      <PageHeader title={t('guilds.title')} description={t('guilds.description')} />
      <QueryState query={guilds} label={t('common.loading')}>
        {(data) =>
          data.guilds.length === 0 ? (
            <Empty title={t('guilds.empty')} glyph="▢" />
          ) : (
            <CardList
              items={data.guilds}
              keyOf={(guild) => guild.id}
              moreLabel={t('common.showMore')}
              render={(guild) => (
                <Link
                  to="/guilds/$guildId"
                  params={{ guildId: guild.id }}
                  className="notched flex items-center gap-4 bg-panel p-4 hover:notch-accent"
                >
                  <Avatar name={guild.name} src={guild.icon} size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-pixel text-sm text-ink">{guild.name}</span>
                    <span className="text-desc mt-1 block">
                      {t('common.members', { count: guild.memberCount })}
                    </span>
                  </span>
                  <span className="text-badge text-accent-soft">{t('guilds.open')}</span>
                </Link>
              )}
            />
          )
        }
      </QueryState>
    </Page>
  );
}
