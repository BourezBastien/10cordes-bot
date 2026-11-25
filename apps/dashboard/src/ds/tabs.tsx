import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * ONGLETS. Une ligne de libellés en pixel ; l'onglet retenu porte une barre
 * d'accent de 3 px qui recouvre le filet de la ligne. La ligne défile en
 * largeur sans passer à la ligne (un onglet coupé au bord signale la suite)
 * et l'onglet retenu est ramené dans la vue. Les flèches déplacent le focus
 * ET retiennent l'onglet atteint (activation automatique). Chaque panneau
 * n'est monté que lorsqu'il est retenu.
 */

const SCROLL_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Amène l'onglet retenu dans la largeur visible de sa ligne, sans toucher au défilement de la page. */
export function revealSelected(container: HTMLDivElement): void {
  const selected = container.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!selected) return;
  const left = selected.offsetLeft;
  const right = left + selected.offsetWidth;
  const target = left < container.scrollLeft ? left : right > container.scrollLeft + container.clientWidth ? right - container.clientWidth : null;
  if (target === null || typeof container.scrollTo !== 'function') return;
  const reduced = window.matchMedia(SCROLL_MOTION_QUERY).matches;
  container.scrollTo({ left: target, behavior: reduced ? 'auto' : 'smooth' });
}

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  tabs: ReadonlyArray<TabItem>;
  value: string;
  onChange: (id: string) => void;
  /** Nom du groupe d'onglets, lu par un écran. */
  label: string;
  id?: string;
  className?: string;
}

export function Tabs({ tabs, value, onChange, label, id, className }: TabsProps) {
  const base = id ?? useId();
  const line = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (line.current) revealSelected(line.current);
  }, [value]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Math.max(0, tabs.findIndex((tab) => tab.id === value));
    const count = tabs.length;
    let next = -1;
    if (event.key === 'ArrowRight') next = (current + 1) % count;
    else if (event.key === 'ArrowLeft') next = (current - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else return;
    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onChange(tab.id);
    document.getElementById(`${base}-tab-${tab.id}`)?.focus();
  };

  return (
    <div className={className}>
      {/* La ligne défile par-dessus le filet de son cadre : la barre d'accent le recouvre sans sortir de la zone défilante. */}
      <div className="relative border-b-2 border-line">
        <div
          ref={line}
          className="relative -mb-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex w-max min-w-full gap-1">
            {tabs.map((tab) => {
              const selected = tab.id === value;
              return (
                <button
                  key={tab.id}
                  id={`${base}-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`${base}-panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onChange(tab.id)}
                  className={cn(
                    'text-badge h-11 border-b-[3px] px-4 whitespace-nowrap select-none enabled:active:translate-y-px',
                    selected ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink-soft',
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {tabs.map((tab) =>
        tab.id === value ? (
          <div
            key={tab.id}
            id={`${base}-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`${base}-tab-${tab.id}`}
            className="pt-4 anim-slide"
          >
            {tab.content}
          </div>
        ) : null,
      )}
    </div>
  );
}
