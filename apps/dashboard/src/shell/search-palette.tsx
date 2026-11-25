import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useModalDialog } from '@/ds/use-modal-dialog';

/*
 * PALETTE DE RECHERCHE. Une boîte en haut de l'écran, ouverte par `/` ou
 * Ctrl+K : on tape, la liste se resserre, Entrée ouvre la destination
 * active. La recherche ignore la casse et les accents. Deux groupes : les
 * pages, puis les serveurs.
 */

export interface Destination {
  key: string;
  group: 'pages' | 'servers';
  label: string;
  hint?: string;
  go: () => void;
}

/** Chaîne pliée : sans casse ni accents, pour chercher « regles » et trouver « Règles ». */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Destinations dont le nom ou l'indice contient tous les mots de la requête. */
export function filterDestinations(items: ReadonlyArray<Destination>, query: string): Destination[] {
  const words = fold(query)
    .split(/\s+/u)
    .filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const haystack = `${fold(item.label)} ${fold(item.hint ?? '')}`;
    return words.every((word) => haystack.includes(word));
  });
}

export interface SearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: ReadonlyArray<Destination>;
}

export function SearchPalette({ open, onOpenChange, destinations }: SearchPaletteProps) {
  const { t } = useTranslation();
  const { ref, close, dialogProps } = useModalDialog({ open, onClosed: () => onOpenChange(false), locked: false });
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const shown = useMemo(() => filterDestinations(destinations, query), [destinations, query]);

  // À chaque ouverture : champ vidé, focus au clavier, premier choix actif.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    input.current?.focus();
  }, [open]);

  // Une nouvelle requête remet le premier résultat en actif.
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Le choix actif reste dans la partie visible de la liste.
  useEffect(() => {
    if (!open) return;
    const node = list.current?.querySelector('[aria-selected="true"]');
    if (node instanceof HTMLElement && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [open, active]);

  const go = (index: number) => {
    const destination = shown[index];
    if (!destination) return;
    close();
    destination.go();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = shown.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count === 0) return;
      setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(active);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : Math.max(0, count - 1));
    }
  };

  const group = (name: 'pages' | 'servers', label: string) => {
    const items = shown.filter((item) => item.group === name);
    if (items.length === 0) return null;
    return (
      <>
        <li role="presentation" className="text-label px-4 pt-3 pb-1">
          {label}
        </li>
        {items.map((item) => {
          const index = shown.indexOf(item);
          const isActive = index === active;
          return (
            <li
              key={item.key}
              id={`palette-${index}`}
              role="option"
              aria-selected={isActive}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => go(index)}
              className={cn('flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2', isActive && 'bar-accent bg-hover')}
            >
              <span className={cn('truncate text-sm', isActive ? 'text-ink' : 'text-ink-soft')}>{item.label}</span>
              {item.hint ? <span className="shrink-0 text-xs text-ink-faint">{item.hint}</span> : null}
            </li>
          );
        })}
      </>
    );
  };

  return (
    <dialog
      ref={ref}
      aria-label={t('nav.search')}
      className="mx-auto mt-[12vh] mb-0 h-fit w-[min(600px,calc(100vw-32px))] max-h-[80vh] border-2 border-edge bg-panel text-ink anim-lift"
      {...dialogProps}
    >
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-expanded
        aria-controls="palette-list"
        aria-autocomplete="list"
        aria-activedescendant={shown[active] ? `palette-${active}` : undefined}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('shell.searchPlaceholder')}
        className="h-14 w-full border-0 border-b-2 border-line bg-field px-4 text-base text-ink placeholder:text-ink-faint focus-visible:border-accent"
      />
      <ul ref={list} id="palette-list" role="listbox" className="max-h-[55vh] overflow-y-auto p-0">
        {shown.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-ink-faint">{t('shell.searchEmpty')}</li>
        ) : null}
        {group('pages', t('shell.pagesGroup'))}
        {group('servers', t('shell.serversGroup'))}
      </ul>
      <p className="sr-only">{t('shell.searchHint')}</p>
    </dialog>
  );
}
