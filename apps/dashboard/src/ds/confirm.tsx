import { useId } from 'react';
import type { ReactNode } from 'react';
import { Button } from './button';
import { useModalDialog } from './use-modal-dialog';

/*
 * CONFIRMATION. Une boîte centrée pour une action qu'on ne retire pas :
 * titre, message, un bouton d'annulation et le bouton de l'action, en rouge
 * par défaut. Les libellés viennent du propriétaire : ils sont traduits.
 */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  message: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  onConfirm: () => void;
  /** L'action est en cours : les deux boutons attendent. */
  busy?: boolean;
  destructive?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  busy = false,
  destructive = true,
}: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const { ref, close, dialogProps } = useModalDialog({ open, onClosed: () => onOpenChange(false), locked: busy });

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      aria-busy={busy || undefined}
      className="m-auto w-[min(440px,calc(100vw-32px))] border-2 bg-panel text-ink anim-lift"
      {...dialogProps}
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 id={titleId} className="text-base">
          {title}
        </h2>
        <p id={messageId} className="text-sm leading-relaxed text-ink-soft">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={close}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'solid'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
