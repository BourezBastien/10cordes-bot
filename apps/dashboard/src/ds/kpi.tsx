import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Frame, type FrameTone } from './frame';
import { Typed } from './typed';

/*
 * MESURES ET MESSAGES. `Kpi` : un cadre, un libellé, une grande valeur.
 * `Empty` : un cadre pointillé, un glyphe, une phrase. `Spinner` : un pixel
 * qui tourne. `Notice` : une surface à barre latérale. `PageHeader` :
 * l'en-tête d'une page, titre écrit au chargement.
 */

export interface KpiProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: FrameTone;
  className?: string;
}

export function Kpi({ label, value, sub, tone = 'line', className }: KpiProps) {
  return (
    <Frame tone={tone} className={cn('flex min-w-0 flex-col gap-1 p-4', className)}>
      <span className="text-label">{label}</span>
      <span className="font-pixel text-2xl text-ink">{value}</span>
      {sub ? <span className="text-xs text-ink-faint">{sub}</span> : null}
    </Frame>
  );
}

export interface EmptyProps {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  glyph?: string;
}

export function Empty({ title, hint, action, glyph = '▢' }: EmptyProps) {
  return (
    <div className="flex flex-col items-center gap-2 border-2 border-dashed border-line px-6 py-10 text-center">
      <span aria-hidden className="font-pixel text-2xl text-ink-faint">
        {glyph}
      </span>
      <p className="text-sm text-ink-soft">{title}</p>
      {hint ? <p className="max-w-prose text-xs text-ink-faint">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label, className }: { label: string; className?: string }) {
  return (
    <span role="status" className={cn('inline-grid h-4 w-4 shrink-0 align-middle', className)}>
      <span className="sr-only">{label}</span>
      <span aria-hidden className="h-2 w-2 bg-accent anim-orbit" />
    </span>
  );
}

export type NoticeTone = 'accent' | 'ok' | 'warn' | 'danger' | 'info';

const BAR: Record<NoticeTone, string> = {
  accent: 'bar-accent',
  ok: 'bar-ok',
  warn: 'bar-warn',
  danger: 'bar-danger',
  info: 'bar-info',
};

export interface NoticeProps {
  tone?: NoticeTone;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Notice({ tone = 'accent', title, children, className }: NoticeProps) {
  return (
    <div role={tone === 'danger' || tone === 'warn' ? 'alert' : 'note'} className={cn('bg-panel-deep px-4 py-3 text-sm text-ink-soft', BAR[tone], className)}>
      {title ? <div className="text-label mb-1">{title}</div> : null}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

export interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="text-label mb-2 flex flex-wrap items-center gap-2 anim-pull">{eyebrow}</div> : null}
        <h1 className="text-2xl sm:text-[28px]">
          <Typed as="span" text={title} />
        </h1>
        {description ? <p className="text-desc mt-2 max-w-prose">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
