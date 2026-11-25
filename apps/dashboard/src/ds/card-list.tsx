import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { staggerStyle } from './typed';

/*
 * LISTE DE CARTES. Neuf cartes d'abord ; « Afficher plus » en révèle neuf
 * autres. Chaque carte apparaît en quatre pas, avec un retard qui suit son
 * rang dans sa fournée : les cartes déjà affichées ne rejouent pas.
 */

export interface CardListProps<Item> {
  items: ReadonlyArray<Item>;
  keyOf: (item: Item) => string;
  render: (item: Item, index: number) => ReactNode;
  /** Libellé du bouton ; le nombre de cartes restantes le suit. */
  moreLabel: string;
  batch?: number;
  empty?: ReactNode;
  className?: string;
}

export function CardList<Item>({
  items,
  keyOf,
  render,
  moreLabel,
  batch = 9,
  empty,
  className,
}: CardListProps<Item>) {
  const [count, setCount] = useState(batch);
  // Rang de la première carte de la dernière fournée révélée.
  const [from, setFrom] = useState(0);
  const shown = Math.min(count, items.length);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {shown === 0 ? (
        empty
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {items.slice(0, shown).map((item, index) => (
            <li
              key={keyOf(item)}
              className={index >= from ? 'anim-pull stagger' : undefined}
              style={index >= from ? staggerStyle(index - from) : undefined}
            >
              {render(item, index)}
            </li>
          ))}
        </ul>
      )}
      {shown < items.length ? (
        <div>
          <Button
            size="sm"
            onClick={() => {
              setFrom(shown);
              setCount(shown + batch);
            }}
          >
            {moreLabel} ({items.length - shown})
          </Button>
        </div>
      ) : null}
    </div>
  );
}
