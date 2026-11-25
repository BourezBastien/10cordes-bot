import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { NATIVE_CAPABILITIES } from '@10cordes/shared';
import { Feed, type FeedItem } from '@/ds/feed';
import { Kpi, Panel } from '@/ds';
import { useFormat } from '@/lib/format';
import { useAuditPage } from '@/lib/queries';
import { GUILD_PAGES, type GuildPageId } from '@/shell/guild-nav';
import { useGuild } from '@/shell/guild-context';
import { GuildHeader } from '@/shell/guild-header';
import { Page } from '@/shell/page';
import { journalRows } from './journal';
import { useCapabilities, useProviders } from './providers/api';
import { useRules } from './rules/api';
import { useUsage } from './system/api';

/*
 * ACCUEIL. Ce que fait le bot sur ce serveur, en un regard : les règles qui
 * le régissent (zones libres, silence, confirmation des actions), l'état de
 * son outillage IA (fournisseurs, capacités liées), sa charge (tours sur
 * 24 h), ses dernières actions, et un accès direct à chaque page. Une mesure
 * qui ne peut pas se lire affiche un tiret : elle ne bloque rien.
 */

const DESCRIPTION = {
  providers: 'providers.description',
  integrations: 'integrations.description',
  journal: 'journal.description',
  rules: 'rules.description',
  modules: 'modules.description',
  config: 'config.description',
  memories: 'memories.description',
  system: 'system.description',
  agent: 'agent.description',
} as const satisfies Record<Exclude<GuildPageId, 'home'>, string>;

interface MeasureProps {
  label: string;
  tone?: 'line' | 'accent' | 'ok' | 'warn' | 'danger';
  ready: boolean;
  children?: ReactNode;
}

function Measure({ label, tone = 'line', ready, children }: MeasureProps) {
  return <Kpi label={label} tone={tone} value={ready ? children : '·'} />;
}

export function GuildHomePage() {
  const { t } = useTranslation();
  const format = useFormat();
  const { guildId } = useGuild();
  const rules = useRules(guildId);
  const providers = useProviders(guildId);
  const capabilities = useCapabilities(guildId);
  const usage = useUsage(guildId, '24h');
  const audit = useAuditPage(guildId, 1, 'all');

  const recent: FeedItem[] = audit.data
    ? journalRows(audit.data.entries.slice(0, 6), format.time, (kind) => t(`journal.badges.${kind}`), t('journal.system'))
    : [];

  return (
    <Page>
      <GuildHeader title={t('home.title')} description={t('home.description')} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Measure label={t('home.zones')} ready={Boolean(rules.data)}>
          {format.number((rules.data?.freeCategoryIds.length ?? 0) + (rules.data?.freeChannelIds.length ?? 0))}
        </Measure>
        <Measure label={t('home.blocked')} ready={Boolean(rules.data)} tone={(rules.data?.blockedChannelIds.length ?? 0) > 0 ? 'warn' : 'line'}>
          {format.number(rules.data?.blockedChannelIds.length ?? 0)}
        </Measure>
        <Measure label={rules.data?.confirmDestructiveActions ? t('home.confirmOn') : t('home.confirmOff')} ready={Boolean(rules.data)} tone={rules.data?.confirmDestructiveActions ? 'accent' : 'ok'} />
        <Measure label={t('home.providers')} ready={Boolean(providers.data)}>
          {format.number(providers.data?.providers.filter((provider) => provider.enabled).length ?? 0)}
          <span className="text-sm text-ink-faint"> / {format.number(providers.data?.providers.length ?? 0)}</span>
        </Measure>
        <Measure label={t('home.capabilities')} ready={Boolean(capabilities.data)}>
          {format.number(capabilities.data?.routes.filter((route) => route.main).length ?? 0)}
          <span className="text-sm text-ink-faint"> / {NATIVE_CAPABILITIES.length}</span>
          <span className="text-xs text-ink-faint">{t('home.unbound')}</span>
        </Measure>
        <Measure label={t('home.turns24h')} ready={Boolean(usage.data)} tone="accent">
          {format.compact(usage.data?.turns ?? 0)}
        </Measure>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title={t('home.recent')}>
          <Feed
            framed={false}
            label={t('journal.caption')}
            empty={t('journal.empty')}
            items={recent}
          />
        </Panel>
        <Panel title={t('home.quick')}>
          <ul className="flex flex-col gap-2">
            {GUILD_PAGES.filter((page) => page.id !== 'home').map((page) => (
              <li key={page.id}>
                <Link to={page.to} params={{ guildId }} className="notched flex items-center justify-between gap-3 bg-panel-deep px-4 py-3 hover:notch-accent">
                  <span className="min-w-0">
                    <span className="block font-pixel text-xs text-ink">{t(page.label)}</span>
                    <span className="block truncate text-xs text-ink-faint">{t(DESCRIPTION[page.id as Exclude<GuildPageId, 'home'>])}</span>
                  </span>
                  <span aria-hidden className="text-accent-soft">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </Page>
  );
}
