import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * PROCESSUS. Les étapes d'un travail en cours, dans l'ordre : en attente
 * (carré vide), en cours (carré d'accent clignotant, curseur), terminée
 * (vert), en échec (rouge), passée (filet). Un écran entend l'étape en
 * cours, puis le message de fin.
 */

export type StepState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface ProcessStep {
  key: string;
  label: ReactNode;
  state: StepState;
  detail?: ReactNode;
}

const MARK: Record<StepState, string> = {
  pending: 'border-2 border-line bg-field',
  active: 'bg-accent anim-blink',
  done: 'bg-ok',
  failed: 'bg-danger',
  skipped: 'bg-line',
};

const TEXT: Record<StepState, string> = {
  pending: 'text-ink-faint',
  active: 'text-ink',
  done: 'text-ink-soft',
  failed: 'text-danger-soft',
  skipped: 'text-ink-faint',
};

function textOf(node: ReactNode): string {
  return typeof node === 'string' ? node : '';
}

export interface ProcessProps {
  steps: ReadonlyArray<ProcessStep>;
  /** Nom du processus, lu par un écran. */
  label: string;
  /** Annoncé quand aucune étape n'est en cours. */
  announce?: string;
}

export function Process({ steps, label, announce }: ProcessProps) {
  const current = steps.find((step) => step.state === 'active');
  return (
    <div>
      <ul role="list" aria-label={label} className="flex flex-col">
        {steps.map((step, index) => (
          <li key={step.key} className="relative flex gap-3 pb-4 last:pb-0">
            {index < steps.length - 1 ? (
              <span aria-hidden className="absolute top-4 left-[5px] h-[calc(100%-10px)] w-0.5 bg-line" />
            ) : null}
            <span aria-hidden className={cn('relative mt-1 h-3 w-3 shrink-0', MARK[step.state])} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className={cn('text-sm', TEXT[step.state])}>
                {step.label}
                {step.state === 'active' ? <span className="caret" /> : null}
              </div>
              {step.detail ? <div className="mt-0.5 text-xs text-ink-faint">{step.detail}</div> : null}
            </div>
          </li>
        ))}
      </ul>
      <div role="status" aria-live="polite" className="sr-only">
        {current ? textOf(current.label) : (announce ?? '')}
      </div>
    </div>
  );
}
