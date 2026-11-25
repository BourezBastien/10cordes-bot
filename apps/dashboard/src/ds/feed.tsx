import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Badge, type Tone } from './badge';
import { staggerStyle } from './typed';

/*
 * FLUX. Les lignes d'un journal, du plus récent au plus ancien : heure,
 * badge, texte, méta. Chaque ligne entre en quatre pas, avec le retard de
 * `stagger` (`seen` : lignes d'une page précédente, qui n'entrent pas).
 * Sur mobile, la méta passe sous le texte. `framed` pose le cadre cranté :
 * faux dans un panneau qui porte déjà le sien.
 */

export interface FeedItem {
  key: string;
  time?: ReactNode;
  tone?: Tone;
  badge?: ReactNode;
  text: ReactNode;
  meta?: ReactNode;
}

export interface FeedProps {
  items: ReadonlyArray<FeedItem>;
  /** Nom de la liste, lu par un écran. */
  label: string;
  empty?: ReactNode;
  seen?: number;
  framed?: boolean;
  className?: string;
}

export function Feed({ items, label, empty, seen = 0, framed = true, className }: FeedProps) {
  return (
    <div className={cn(framed && 'notched', 'bg-panel', className)}>
      {items.length === 0 ? (
        <div className="p-6 text-center text-sm text-ink-faint">{empty}</div>
      ) : (
        <ol aria-label={label} className="flex flex-col">
          {items.map((item, index) => (
            <li
              key={item.key}
              className={cn(
                'anim-pull stagger grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[72px_128px_1fr_auto]',
                index > 0 && 'border-t border-line-soft',
              )}
              style={staggerStyle(Math.max(0, index - seen))}
            >
              <span className="text-xs whitespace-nowrap text-ink-faint">{item.time}</span>
              <span className="hidden sm:block">
                {item.badge ? <Badge tone={item.tone ?? 'neutral'}>{item.badge}</Badge> : null}
              </span>
              <span className="col-start-2 row-start-1 text-sm break-words whitespace-pre-wrap text-ink-soft sm:col-start-3">
                {item.text}
              </span>
              {item.meta ? (
                <span className="col-start-2 text-xs text-ink-faint sm:col-start-4 sm:row-start-1 sm:whitespace-nowrap">
                  {item.meta}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
