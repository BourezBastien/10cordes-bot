import { useTranslation } from 'react-i18next';
import type { Tone } from '@/ds/badge';
import { Feed, type FeedItem } from '@/ds/feed';
import { Panel } from '@/ds/frame';
import { useGuild } from '@/shell/guild-context';
import { GuildHeader } from '@/shell/guild-header';
import { Page, QueryState } from '@/shell/page';
import { useFormat } from '@/lib/format';
import { useMemories } from '@/lib/queries';

/*
 * MÉMOIRES. Les fiches consolidées que le bot garde du serveur, puis celles
 * des membres (avec l'identifiant du membre), et les corrections : un fait
 * qu'un membre a corrigé, qui prime sur tout le reste. Une entrée que la
 * correction a périmée reste affichée, marquée. Rien ne s'édite ici : le bot
 * les tient à jour, par la conversation.
 */

type Kind = 'fact' | 'rule' | 'presentation' | 'preference' | 'note';
type Card = { id: string; kind: string; content: string; createdAt: string | number; supersededAt?: string | number | null; userId?: string };
type Correction = { id: string; userId: string | null; oldFact: string; newFact: string; createdAt: string | number; supersededAt?: string | number | null };

const TONE: Record<string, Tone> = {
  fact: 'neutral',
  rule: 'accent',
  presentation: 'info',
  preference: 'skill',
  note: 'neutral',
};

function isKind(value: string): value is Kind {
  return ['fact', 'rule', 'presentation', 'preference', 'note'].includes(value);
}

const stillRead = (row: { supersededAt?: string | number | null }): boolean => row.supersededAt === undefined || row.supersededAt === null;

export function memoryRows(cards: ReadonlyArray<Card>, date: (value: string | number) => string, label: (kind: string) => string, superseded: string): FeedItem[] {
  return cards.map((card) => ({
    key: card.id,
    time: date(card.createdAt),
    // Une entrée périmée ne se distingue plus par sa nature : l'agent ne la lit plus.
    tone: stillRead(card) ? (TONE[card.kind] ?? 'neutral') : 'neutral',
    badge: stillRead(card) ? label(isKind(card.kind) ? card.kind : 'fact') : superseded,
    text: card.content,
    meta: 'userId' in card ? card.userId : undefined,
  }));
}

/** Les corrections en lignes : le fait corrigé, ce qu'il remplace, et de quand ça date. */
export function correctionRows(corrections: ReadonlyArray<Correction>, date: (value: string | number) => string, replaces: string, corrected: string): FeedItem[] {
  return corrections.map((correction) => ({
    key: correction.id,
    time: date(correction.createdAt),
    tone: 'warn',
    badge: corrected,
    text: `${correction.newFact} (${replaces} : ${correction.oldFact})`,
    meta: correction.userId,
  }));
}

export function MemoriesPage() {
  const { t } = useTranslation();
  const { guildId } = useGuild();
  const format = useFormat();
  const memories = useMemories(guildId);
  const kindLabel = (kind: string) => t(`memories.kinds.${isKind(kind) ? kind : 'fact'}`);

  return (
    <Page>
      <GuildHeader title={t('memories.title')} description={t('memories.description')} />
      <QueryState query={memories} label={t('common.loading')}>
        {(data) => (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title={t('memories.guild')} label={t('memories.entries', { count: data.guild.filter(stillRead).length })}>
              <Feed
                framed={false}
                label={t('memories.caption')}
                empty={t('memories.empty')}
                items={memoryRows(data.guild, format.date, kindLabel, t('memories.superseded'))}
              />
            </Panel>
            <Panel title={t('memories.members')} label={t('memories.entries', { count: data.members.filter(stillRead).length })}>
              <Feed
                framed={false}
                label={t('memories.caption')}
                empty={t('memories.empty')}
                items={memoryRows(data.members, format.date, kindLabel, t('memories.superseded'))}
              />
            </Panel>
            <Panel
              className="xl:col-span-2"
              title={t('memories.corrections')}
              label={t('memories.entries', { count: data.corrections.filter(stillRead).length })}
            >
              <p className="text-desc mb-3">{t('memories.correctionsHint')}</p>
              <Feed
                framed={false}
                label={t('memories.corrections')}
                empty={t('memories.correctionsEmpty')}
                items={correctionRows(data.corrections, format.date, t('memories.replaces'), t('memories.corrected'))}
              />
            </Panel>
          </div>
        )}
      </QueryState>
    </Page>
  );
}
