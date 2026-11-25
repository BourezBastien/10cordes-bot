import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import Chart from 'react-apexcharts';
import { THINKING_MODES, type ThinkingMode, type UsageByModel, type UsageWindow } from '@10cordes/shared';
import { Field, Select } from '@/ds';
import { Empty, Kpi, Panel } from '@/ds';
import { DataTable, type TableColumn } from '@/ds/table';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useGuild } from '@/shell/guild-context';
import { GuildHeader } from '@/shell/guild-header';
import { Page, QueryState } from '@/shell/page';
import { useAgentSettings, useSaveThinkingMode, useUsage } from './api';

/*
 * SYSTÈME. Ce que l'agent du serveur a consommé (tours, jetons d'entrée et
 * de sortie, erreurs, replis) sur une fenêtre, par modèle et par jour ; puis
 * son réglage de réflexion, qui s'enregistre dès qu'il change. Les jetons
 * mesurent la charge, pas une facture : les prix appartiennent aux
 * fournisseurs.
 */

const WINDOWS: ReadonlyArray<UsageWindow> = ['24h', '7d', '30d'];

const WINDOW_LABEL: Record<UsageWindow, 'system.window24h' | 'system.window7d' | 'system.window30d'> = {
  '24h': 'system.window24h',
  '7d': 'system.window7d',
  '30d': 'system.window30d',
};

/** Graphique à barres : ni arrondi, ni ombre, ni animation. Les barres sont là. */
const CHART = {
  chart: {
    background: 'transparent',
    toolbar: { show: false },
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    animations: { enabled: false },
    parentHeightOffset: 0,
  },
  colors: ['#d95926'],
  grid: { borderColor: '#1f1f26', xaxis: { lines: { show: false } }, padding: { left: 8, right: 8 } },
  dataLabels: { enabled: false },
  states: { hover: { filter: { type: 'none' as const } }, active: { filter: { type: 'none' as const } } },
  xaxis: {
    axisBorder: { color: '#3a3a44' },
    axisTicks: { color: '#3a3a44' },
    labels: { style: { colors: '#a6a6b2' } },
  },
  yaxis: { labels: { style: { colors: '#a6a6b2' } } },
  tooltip: { theme: 'dark' as const },
  plotOptions: { bar: { borderRadius: 0, columnWidth: '60%' } },
};

const tokensOf = (row: UsageByModel): number => row.promptTokens + row.completionTokens;

function ModelCell({ row }: { row: UsageByModel }) {
  return (
    <span className="flex flex-col">
      <span className="text-ink">{row.model}</span>
      <span className="text-xs text-ink-faint">{row.provider ?? ''}</span>
    </span>
  );
}

export function SystemPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const { guildId } = useGuild();
  const [window, setWindow] = useState<UsageWindow>('24h');
  const usage = useUsage(guildId, window);
  const settings = useAgentSettings(guildId);
  const save = useSaveThinkingMode(guildId);

  const choose = (mode: string) => {
    if (!(THINKING_MODES as readonly string[]).includes(mode)) return;
    save.mutate(mode as ThinkingMode, {
      onSuccess: () => toast.success(t('system.thinkingSaved')),
      onError: (error: unknown) => toast.error(errorMessage(error)),
    });
  };

  const columns: TableColumn<UsageByModel>[] = [
    { key: 'model', header: t('system.model'), cell: (row) => <ModelCell row={row} /> },
    { key: 'turns', header: t('system.calls'), className: 'text-right tabular-nums', cell: (row) => format.number(row.turns) },
    {
      key: 'tokens',
      header: t('system.tokens'),
      className: 'text-right tabular-nums',
      cell: (row) => format.compact(tokensOf(row)),
    },
    {
      key: 'errors',
      header: t('system.errors'),
      className: 'text-right tabular-nums',
      cell: (row) => (row.errors > 0 ? <span className="text-danger-soft">{format.number(row.errors)}</span> : '0'),
    },
    { key: 'fallbacks', header: t('system.fallbacks'), className: 'text-right tabular-nums', cell: (row) => format.number(row.fallbacks) },
  ];

  return (
    <Page>
      <GuildHeader title={t('system.title')} description={t('system.description')} />

      <div role="group" aria-label={t('system.usage')} className="flex flex-wrap gap-1 self-start">
        {WINDOWS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={value === window}
            onClick={() => setWindow(value)}
            className={cn(
              'text-badge h-9 border-2 px-3 hover:border-edge hover:text-ink enabled:active:translate-y-px',
              value === window ? 'border-accent bg-accent-deep text-accent-soft' : 'border-line bg-panel text-ink-muted',
            )}
          >
            {t(WINDOW_LABEL[value])}
          </button>
        ))}
      </div>

      <QueryState query={usage} label={t('common.loading')}>
        {(data) => (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
              <Kpi label={t('system.turns')} value={format.compact(data.turns)} tone="accent" />
              <Kpi label={t('system.promptTokens')} value={format.compact(data.promptTokens)} />
              <Kpi label={t('system.completionTokens')} value={format.compact(data.completionTokens)} />
              <Kpi label={t('system.errors')} value={format.number(data.errors)} tone={data.errors > 0 ? 'danger' : 'line'} />
              <Kpi label={t('system.fallbacks')} value={format.number(data.fallbacks)} tone={data.fallbacks > 0 ? 'warn' : 'line'} />
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Panel title={t('system.byModel')}>
                <DataTable
                  caption={t('system.byModel')}
                  rows={[...data.byModel].sort((a, b) => tokensOf(b) - tokensOf(a))}
                  keyOf={(row) => `${row.provider}-${row.model}`}
                  columns={columns}
                  empty={t('system.noUsage')}
                />
              </Panel>
              <Panel title={t('system.byDay')}>
                {data.byDay.length === 0 ? (
                  <Empty title={t('system.noUsage')} glyph="▥" />
                ) : (
                  <Chart
                    type="bar"
                    height={260}
                    series={[{ name: t('system.tokens'), data: data.byDay.map((day) => day.tokens) }]}
                    options={{ ...CHART, xaxis: { ...CHART.xaxis, categories: data.byDay.map((day) => day.day.slice(5)) } }}
                  />
                )}
              </Panel>
            </div>
          </>
        )}
      </QueryState>

      <Panel title={t('system.settings')} className="max-w-xl">
        <QueryState query={settings} label={t('common.loading')}>
          {(data) => (
            <Field label={t('system.thinking')} hint={t('system.settingsHint')}>
              {(control) => (
                <Select
                  {...control}
                  value={data.thinkingMode}
                  disabled={save.isPending}
                  onChange={choose}
                  options={THINKING_MODES.map((mode) => ({ value: mode, label: t(`system.thinkingModes.${mode}`) }))}
                />
              )}
            </Field>
          )}
        </QueryState>
      </Panel>
    </Page>
  );
}
