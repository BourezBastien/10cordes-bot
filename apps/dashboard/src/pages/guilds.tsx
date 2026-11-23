import { useQuery } from '@tanstack/react-query';
import { Navigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface GuildSummary {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number;
  canManage: boolean;
}

export function GuildsPage() {
  const { t } = useTranslation();
  const { data: session, isPending } = useSession();
  const guildsQuery = useQuery({
    queryKey: ['guilds'],
    queryFn: () => api.get<{ guilds: GuildSummary[] }>('/api/v1/guilds'),
    enabled: !isPending && Boolean(session),
  });

  if (isPending) {
    return <div className="grid h-full place-items-center text-ink-muted">{t('common.loading')}</div>;
  }
  if (!session) {
    return <Navigate to="/login" />;
  }

  const guilds = guildsQuery.data?.guilds ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">{t('guilds.title')}</h1>
      {guilds.length === 0 ? (
        <p className="text-ink-muted">{t('guilds.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {guilds.map((guild) => (
            <Card key={guild.id} className="transition-colors hover:border-accent">
              <CardHeader className="flex-row items-center gap-3">
                {guild.icon ? (
                  <img
                    src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`}
                    alt=""
                    className="h-10 w-10 rounded-md"
                  />
                ) : (
                  <div className="grid h-10 w-10 place-items-center rounded-md bg-accent font-bold text-canvas">
                    {guild.name.charAt(0)}
                  </div>
                )}
                <CardTitle className="truncate">{guild.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <span className="text-sm text-ink-muted">
                  {guild.memberCount} {t('guilds.members')}
                </span>
                <a href={`/g/${guild.id}`} className="text-sm font-medium text-accent hover:underline">
                  {t('nav.home')} →
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
