import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from '@tanstack/react-router';
import Chart from 'react-apexcharts';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface StatsResponse {
  windowDays: number;
  auditByAction: Array<{ action: string; count: number }>;
  topXp: Array<{ userId: string; level: number; xp: number }>;
  moderation: { cases14d: number; byAction: Array<{ action: string; count: number }> };
}

const chartOptions = {
  chart: { background: 'transparent', toolbar: { show: false } },
  theme: { mode: 'dark' as const },
  colors: ['#72C99B'],
  grid: { borderColor: '#303038' },
  xaxis: { axisBorder: { color: '#303038' }, axisTicks: { color: '#303038' }, labels: { style: { colors: '#A0A0AD' } } },
  yaxis: { labels: { style: { colors: '#A0A0AD' } } },
  dataLabels: { enabled: false },
};

export function StatsPage() {
  const { t } = useTranslation();
  const { guildId } = useParams({ from: '/g/$guildId' });

  const statsQuery = useQuery({
    queryKey: ['guild', guildId, 'stats'],
    queryFn: () => api.get<StatsResponse>(`/api/v1/guilds/${guildId}/stats`),
  });

  const data = statsQuery.data;
  const auditTop = [...(data?.auditByAction ?? [])].sort((a, b) => b.count - a.count).slice(0, 10);
  const casesTop = [...(data?.moderation.byAction ?? [])].sort((a, b) => b.count - a.count);

  if (statsQuery.isPending) {
    return <div className="p-8 text-ink-muted">{t('common.loading')}</div>;
  }

  return (
    <div className="mx-auto w-full max-w-4xl p-8">
      <h1 className="mb-1 text-2xl font-semibold">{t('nav.stats')}</h1>
      <p className="mb-6 text-sm text-ink-muted">{`${data?.windowDays ?? 14} ${t('stats.windowDays')}`}</p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('stats.auditByAction')}</CardTitle>
        </CardHeader>
        <CardContent>
          {auditTop.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('stats.empty')}</p>
          ) : (
            <Chart
              type="bar"
              height={280}
              series={[{ name: t('stats.count'), data: auditTop.map((row) => row.count) }]}
              options={{
                ...chartOptions,
                xaxis: { ...chartOptions.xaxis, categories: auditTop.map((row) => row.action) },
              }}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('stats.topXp')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2">
              {(data?.topXp ?? []).map((row, index) => (
                <li key={row.userId} className="flex items-center justify-between rounded-md border border-line bg-canvas px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-ink-muted">
                    #{index + 1} · {row.userId}
                  </span>
                  <span>
                    {t('stats.level')} <strong>{row.level}</strong> ({row.xp} XP)
                  </span>
                </li>
              ))}
              {(data?.topXp ?? []).length === 0 ? <p className="text-sm text-ink-muted">{t('stats.empty')}</p> : null}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('stats.moderation')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-ink-muted">
              {t('stats.cases14d')} : <strong>{data?.moderation.cases14d ?? 0}</strong>
            </p>
            {casesTop.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('stats.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {casesTop.map((row) => (
                  <li key={row.action} className="flex items-center justify-between">
                    <span className="font-mono text-xs">{row.action}</span>
                    <span className="font-medium">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
