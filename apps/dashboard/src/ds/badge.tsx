import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/format';
import { useNow } from '@/lib/use-now';

/*
 * BADGES ET ÉTATS. Un badge est un nom court en pixel, souligné d'un filet
 * de 2 px ou plein. La pastille d'état est un carré de 8 px : vert (actif),
 * jaune clignotant (refroidissement, avec son compte à rebours), rouge
 * (erreur), filet (inconnu). Un écran lit l'état, jamais les secondes.
 */

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'skill';

const OUTLINE: Record<Tone, string> = {
  neutral: 'border-line text-ink-soft',
  accent: 'border-accent bg-accent-deep text-accent-soft',
  ok: 'border-ok bg-ok-deep text-ok',
  warn: 'border-warn bg-warn-deep text-warn',
  danger: 'border-danger bg-danger-deep text-danger-soft',
  info: 'border-info bg-info-deep text-info',
  skill: 'border-skill bg-skill-deep text-skill',
};

const SOLID: Record<Tone, string> = {
  neutral: 'border-line bg-line text-ink',
  accent: 'border-accent bg-accent text-accent-ink',
  ok: 'border-ok bg-ok text-ok-ink',
  warn: 'border-warn bg-warn text-warn-ink',
  danger: 'border-danger bg-danger text-danger-ink',
  info: 'border-info bg-info text-info-ink',
  skill: 'border-skill bg-skill text-skill-ink',
};

export interface BadgeProps {
  tone?: Tone;
  solid?: boolean;
  /** Détail au survol. */
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', solid = false, title, className, children }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'text-badge inline-flex items-center gap-1 border-2 px-1.5 py-0.5 whitespace-nowrap',
        solid ? SOLID[tone] : OUTLINE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export type StatusState = 'active' | 'cooldown' | 'error' | 'unknown';

export interface StatusLabels {
  active: string;
  cooldown: string;
  error: string;
  unknown: string;
}

export interface StatusDotProps {
  state: StatusState;
  /** Fin du refroidissement (ISO), quand l'état le donne. */
  cooldownUntil?: string | null;
  labels: StatusLabels;
  /** Détail au survol (dernière erreur). */
  title?: string | null;
}

const DOT: Record<StatusState, string> = {
  active: 'bg-ok',
  cooldown: 'bg-warn anim-blink',
  error: 'bg-danger',
  unknown: 'bg-line',
};

const TEXT: Record<StatusState, string> = {
  active: 'text-ok',
  cooldown: 'text-warn',
  error: 'text-danger-soft',
  unknown: 'text-ink-faint',
};

export function StatusDot({ state, cooldownUntil, labels, title }: StatusDotProps) {
  const deadline = state === 'cooldown' && cooldownUntil ? Date.parse(cooldownUntil) : Number.NaN;
  const counting = state === 'cooldown' && Number.isFinite(deadline);
  const now = useNow(counting ? 1000 : 0);
  const remaining = counting ? Math.max(0, (deadline ?? 0) - now) : 0;
  // Un refroidissement arrivé à son terme : le fournisseur est de nouveau disponible, jusqu'au prochain relevé.
  const effective: StatusState = counting && remaining === 0 ? 'active' : state;
  const shown = effective === 'cooldown' && counting ? `${labels.cooldown} ${formatDuration(remaining)}` : labels[effective];
  return (
    <span title={title ?? undefined} className={cn('inline-flex items-center gap-2 text-xs', TEXT[effective])}>
      <span aria-hidden className={cn('h-2 w-2 shrink-0', DOT[effective])} />
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{labels[effective]}</span>
    </span>
  );
}
