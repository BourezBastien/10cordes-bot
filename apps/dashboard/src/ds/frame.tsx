import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * CADRES. `Frame` est le contenant de base : une surface, un cadre cranté de
 * 2 px, ni angle ni ombre. `Panel` y ajoute une en-tête (libellé, titre,
 * actions) séparée du corps par un filet. `Section` titre une zone de page.
 * Deux cadres voisins demandent au moins 4 px d'écart : le cadre est hors
 * du cadre de mise en page.
 */

export type FrameTone = 'line' | 'edge' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';

const toneClass: Record<FrameTone, string> = {
  line: '',
  edge: 'notch-edge',
  accent: 'notch-accent',
  ok: 'notch-ok',
  warn: 'notch-warn',
  danger: 'notch-danger',
  info: 'notch-info',
};

export interface FrameProps extends HTMLAttributes<HTMLDivElement> {
  tone?: FrameTone;
}

export function Frame({ tone = 'line', className, ...props }: FrameProps) {
  return <div className={cn('notched bg-panel', toneClass[tone], className)} {...props} />;
}

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: FrameTone;
  title: ReactNode;
  label?: ReactNode;
  actions?: ReactNode;
}

export function Panel({ tone = 'line', title, label, actions, className, children, ...props }: PanelProps) {
  return (
    <Frame tone={tone} className={cn('flex min-w-0 flex-col', className)} {...props}>
      <div className="flex items-end justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          {label ? <div className="text-label mb-1">{label}</div> : null}
          <h2 className="truncate text-base">{title}</h2>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </Frame>
  );
}

export interface SectionProps {
  /** Lettre de la zone (A, B, C), affichée en regard du titre. */
  index: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function Section({ index, title, description, actions, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-3" aria-label={typeof title === 'string' ? title : undefined}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-3 text-lg anim-type">
            <span className="bg-accent px-2 py-0.5 text-sm text-accent-ink" aria-hidden>
              {index}
            </span>
            <span>{title}</span>
          </h2>
          {description ? <p className="text-desc mt-2">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
