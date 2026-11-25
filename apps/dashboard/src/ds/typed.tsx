import type { CSSProperties, ElementType } from 'react';
import { cn } from '@/lib/utils';

/*
 * TEXTE ÉCRIT. Un titre se découvre de gauche à droite en huit pas, sans
 * que la mise en page bouge : le texte occupe sa place d'emblée, un masque
 * le révèle. Le curseur clignote le temps de la frappe puis se retire.
 * Purement CSS : aucun état, aucun rendu en cours de frappe, et le texte
 * entier est là dès le premier rendu, pour un écran comme pour un test.
 */

export interface TypedProps {
  text: string;
  /** Durée par caractère ; la durée totale reste entre 200 ms et 1 400 ms. */
  msPerChar?: number;
  className?: string;
  as?: ElementType;
}

export function Typed({ text, msPerChar = 22, className, as: Tag = 'span' }: TypedProps) {
  const ms = Math.round(Math.min(1400, Math.max(200, text.length * msPerChar)));
  return (
    <Tag className={cn('inline', className)}>
      <span aria-hidden className="inline-block anim-type" style={{ animationDuration: `${ms}ms` }}>
        {text}
      </span>
      <span aria-hidden className="anim-life" style={{ animationDuration: `${ms}ms` }}>
        <span className="caret" />
      </span>
      <span className="sr-only">{text}</span>
    </Tag>
  );
}

/** Style inline qui pose l'index d'entrée d'un élément (voir l'utilitaire `stagger`). */
export function staggerStyle(index: number): CSSProperties {
  return { '--i': index } as CSSProperties;
}
