import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ds/button';
import type { Tone } from '@/ds/badge';
import { Feed, type FeedItem } from '@/ds/feed';
import { useGuild } from '@/shell/guild-context';
import { GuildHeader } from '@/shell/guild-header';
import { Page, QueryState } from '@/shell/page';
import { useFormat } from '@/lib/format';
import { JOURNAL_KINDS, useAuditPage, type JournalKind } from '@/lib/queries';
import type { AuditEntry } from '@/lib/schemas';
import { cn } from '@/lib/utils';

/*
 * JOURNAL. Ce que le bot a fait sur ce serveur, du plus récent : quatre
 * filtres (tout, actions, plans de confirmation, erreurs), 25 lignes par
 * page. La première page du filtre « tout » se relit toutes les 20 secondes.
 * Le filtre s'applique côté serveur (`kind`), jamais à la seule page affichée.
 */

const ERROR_ACTION = /^(assistant\.error|tool\.denied\.|rule\.confirm\.denied$)/u;

export type EntryKind = 'action' | 'plan' | 'error' | 'tool';

/*
 * Nature d'une entrée, par son action : la même règle que le filtre `kind`
 * du serveur, pour qu'un badge dise ce que le filtre retient. Les plans
 * commencent par « plan. », les erreurs sont les siennes du bot, les outils
 * sont les appels d'assistant (réussis ou non : un outil en échec reste un
 * outil, son résumé le dit).
 */
export function entryKind(action: string): EntryKind {
  if (ERROR_ACTION.test(action)) return 'error';
  if (action.startsWith('plan.')) return 'plan';
  if (action.startsWith('assistant.tool.')) return 'tool';
  return 'action';
}

const TONE: Record<EntryKind, Tone> = { action: 'neutral', plan: 'skill', error: 'danger', tool: 'info' };

/** Ce qu'une entrée dit en clair : son résumé s'il en a un. Le détail brut reste dans la ligne. */
export function describeMetadata(metadata: string): { summary: string | null } {
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!parsed || typeof parsed !== 'object') return { summary: null };
    const record = parsed as Record<string, unknown>;
    return { summary: typeof record.summary === 'string' ? record.summary : null };
  } catch {
    return { summary: null };
  }
}

export function journalRows(
  entries: ReadonlyArray<AuditEntry>,
  clock: (value: string | number) => string,
  label: (kind: EntryKind) => string,
  system: string,
): FeedItem[] {
  return entries.map((entry) => {
    const kind = entryKind(entry.action);
    const summary = describeMetadata(entry.metadata).summary;
    return {
      key: entry.id,
      time: clock(entry.createdAt),
      tone: TONE[kind],
      badge: label(kind),
      text: summary ? `${entry.action} · ${summary}` : entry.action,
      meta: entry.actorId ? `…${entry.actorId.slice(-6)}` : system,
    };
  });
}

export function JournalPage() {
  const { t } = useTranslation();
  const { guildId } = useGuild();
  const format = useFormat();
  const [kind, setKind] = useState<JournalKind>('all');
  const [page, setPage] = useState(1);
  const audit = useAuditPage(guildId, page, kind);

  return (
    <Page>
      <GuildHeader title={t('journal.title')} description={t('journal.description')} />
      <div role="group" aria-label={t('journal.filters.all')} className="flex flex-wrap gap-1">
        {JOURNAL_KINDS.map((value) => {
          const active = value === kind;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setKind(value);
                setPage(1);
              }}
              className={cn(
                'text-badge h-9 border-2 px-3 hover:border-edge hover:text-ink enabled:active:translate-y-px',
                active ? 'border-accent bg-accent-deep text-accent-soft' : 'border-line bg-panel text-ink-muted',
              )}
            >
              {t(`journal.filters.${value}`)}
            </button>
          );
        })}
      </div>
      <QueryState query={audit} label={t('common.loading')}>
        {(data) => (
          <>
            <p className="text-desc">
              {t('journal.entries', { count: data.total })} · {t('journal.page', { page: data.page, pages: data.pages })}
            </p>
            <Feed
              label={t('journal.caption')}
              empty={t('journal.empty')}
              seen={(data.page - 1) * data.pageSize}
              items={journalRows(data.entries, format.time, (entry) => t(`journal.badges.${entry}`), t('journal.system'))}
            />
            <div className="flex items-center justify-end gap-3">
              <Button size="sm" disabled={data.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                {t('journal.prev')}
              </Button>
              <Button size="sm" disabled={data.page >= data.pages} onClick={() => setPage((current) => current + 1)}>
                {t('journal.next')}
              </Button>
            </div>
          </>
        )}
      </QueryState>
    </Page>
  );
}
