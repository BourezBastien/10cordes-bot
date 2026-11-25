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
 * des membres (avec l'identifiant du membre). Une fiche : une nature, un
 * texte, une date. Rien ne s'édite ici : le bot les tient à jour.
 */

type Kind = 'fact' | 'rule' | 'presentation' | 'preference' | 'note';
type Card = { id: string; kind: string; content: string; createdAt: string | number; userId?: string };

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

export function memoryRows(cards: ReadonlyArray<Card>, date: (value: string | number) => string, label: (kind: string) => string): FeedItem[] {
  return cards.map((card) => ({
    key: card.id,
    time: date(card.createdAt),
    tone: TONE[card.kind] ?? 'neutral',
    badge: label(isKind(card.kind) ? card.kind : 'fact'),
    text: card.content,
    meta: card.userId,
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
            <Panel title={t('memories.guild')} label={t('memories.entries', { count: data.guild.length })}>
              <Feed
                framed={false}
                label={t('memories.caption')}
                empty={t('memories.empty')}
                items={memoryRows(data.guild, format.date, kindLabel)}
              />
            </Panel>
            <Panel title={t('memories.members')} label={t('memories.entries', { count: data.members.length })}>
              <Feed
                framed={false}
                label={t('memories.caption')}
                empty={t('memories.empty')}
                items={memoryRows(data.members, format.date, kindLabel)}
              />
            </Panel>
          </div>
        )}
      </QueryState>
    </Page>
  );
}
