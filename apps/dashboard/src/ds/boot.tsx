import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { BrandMark } from './brand';

/*
 * DÉMARRAGE. Écran d'attente : le sceau flotte par à-coups, et les étapes
 * s'allument l'une après l'autre, la dernière suivie d'un curseur qui
 * clignote. Le texte lu par un écran dit seulement qu'on charge : les noms
 * d'étapes sont un décor.
 */

const BOOT_LINES = ['SESSION', 'SERVEUR', 'DONNEES'] as const;

export interface BootProps {
  /** Message lu par un écran. */
  label: string;
  lines?: ReadonlyArray<string>;
}

export function Boot({ label, lines = BOOT_LINES }: BootProps) {
  const [step, setStep] = useState(0);
  const total = lines.length;

  useEffect(() => {
    if (step >= total) return;
    const timer = window.setTimeout(() => setStep((current) => current + 1), 240);
    return () => window.clearTimeout(timer);
  }, [step, total]);

  return (
    <div role="status" className="flex flex-col items-center gap-5 p-8">
      <span className="sr-only">{label}</span>
      <BrandMark size={48} className="anim-bob" />
      <ul aria-hidden className="flex flex-col gap-1.5">
        {lines.map((line, index) =>
          index <= step ? (
            <li
              key={line}
              className={cn('flex items-center gap-2', index === step ? 'text-ink' : 'text-ink-faint')}
            >
              <span aria-hidden className={cn('h-2 w-2', index === step ? 'bg-accent' : 'bg-ok')} />
              <span className="font-pixel text-xs tracking-widest">{line}</span>
              {index === step ? <span className="caret" /> : null}
            </li>
          ) : null,
        )}
      </ul>
    </div>
  );
}
