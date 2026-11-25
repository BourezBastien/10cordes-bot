import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { useModalDialog } from './use-modal-dialog';

/*
 * TIROIR. Un panneau à droite de l'écran, en dialogue modal natif : le fond
 * est voilé et inerte, le focus reste dedans, Échap ou un clic sur le voile
 * le referment, le focus revient à l'élément qui l'a ouvert. Trois étages :
 * en-tête (titre, description, fermer), corps défilant, pied (actions).
 * En dessous de 640 px il occupe toute la largeur.
 */

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Nom du bouton de fermeture, lu par un écran. */
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Une demande tient le tiroir ouvert : ni Échap ni voile ne le ferment. */
  locked?: boolean;
  size?: 'md' | 'lg';
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
  footer,
  locked = false,
  size = 'md',
}: SheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const { ref, close, dialogProps } = useModalDialog({ open, onClosed: () => onOpenChange(false), locked });

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={locked || undefined}
      className={cn(
        'm-0 ml-auto h-dvh max-h-dvh w-full max-w-full border-2 border-edge bg-panel text-ink anim-lift',
        size === 'lg' ? 'sm:max-w-[640px]' : 'sm:max-w-[480px]',
      )}
      {...dialogProps}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-desc mt-2">
                {description}
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" aria-label={closeLabel} disabled={locked} onClick={close}>
            <X size={16} strokeWidth={2} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">{footer}</div> : null}
      </div>
    </dialog>
  );
}
