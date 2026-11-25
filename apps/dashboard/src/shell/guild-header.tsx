import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/ds/avatar';
import { PageHeader } from '@/ds/kpi';
import type { LiveState } from '@/lib/events';
import { cn } from '@/lib/utils';
import { useGuild } from './guild-context';

/*
 * EN-TÊTE D'UNE PAGE DE SERVEUR. Au-dessus du titre : l'icône et le nom du
 * serveur, puis le témoin du flux temps réel (vert et fixe quand il est
 * ouvert, jaune clignotant pendant la reconnexion, rouge s'il est coupé).
 */

const LIVE_STATE: Record<LiveState, { dot: string; text: 'shell.liveOn' | 'shell.live' | 'shell.liveOff' | null }> = {
  open: { dot: 'bg-ok', text: 'shell.liveOn' },
  connecting: { dot: 'bg-warn anim-blink', text: 'shell.live' },
  error: { dot: 'bg-danger', text: 'shell.liveOff' },
  off: { dot: 'bg-line', text: null },
};

export function LiveDot({ state }: { state: LiveState }) {
  const { t } = useTranslation();
  const current = LIVE_STATE[state];
  if (!current.text) return null;
  return (
    <span className="inline-flex items-center gap-1.5" title={t('shell.live')}>
      <span aria-hidden className={cn('h-1.5 w-1.5', current.dot)} />
      {t(current.text)}
    </span>
  );
}

export interface GuildHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

export function GuildHeader({ title, description, actions }: GuildHeaderProps) {
  const { guild, live } = useGuild();
  const name = guild?.name ?? '';
  return (
    <PageHeader
      title={title}
      description={description}
      actions={actions}
      eyebrow={
        <>
          {guild ? (
            <>
              <Avatar name={name} src={guild.icon} size={20} />
              <span className="text-ink-soft">{name}</span>
            </>
          ) : null}
          <LiveDot state={live} />
        </>
      }
    />
  );
}
