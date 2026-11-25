import { useEffect, useRef, type PointerEvent, type SyntheticEvent } from 'react';

/*
 * DIALOGUE MODAL NATIF. Un <dialog> ouvert par showModal() donne le piège à
 * focus, l'inertie du fond et le retour du focus à l'ouverture fermée.
 * Toute fermeture passe par close() : le bouton, le voile, et Échap (son
 * annulation est toujours empêchée, la fermeture est alors faite par nous).
 * L'état du propriétaire suit dans le même instant, sans attendre l'événement
 * close du dialogue, que certains moteurs ne lancent pas. L'événement reste
 * écouté en filet : un onClosed répété ne change rien.
 * Tant que `locked` est vrai, ni Échap ni un clic sur le voile ne ferment.
 */

export interface ModalDialogProps {
  open: boolean;
  onClosed: () => void;
  locked: boolean;
}

export function useModalDialog({ open, onClosed, locked }: ModalDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // Le pointeur a-t-il été posé sur le voile ? Un glissé depuis le contenu ne compte pas.
  const onBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = () => {
    const dialog = ref.current;
    if (!dialog?.open) return;
    dialog.close();
    onClosed();
  };

  const onPointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    onBackdrop.current = event.target === event.currentTarget;
  };

  const onClick = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (!onBackdrop.current || event.target !== event.currentTarget) return;
    onBackdrop.current = false;
    if (!lockedRef.current) close();
  };

  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (!lockedRef.current) close();
  };

  return { ref, close, dialogProps: { onPointerDown, onClick, onCancel, onClose: onClosed } };
}

export type ModalDialog = ReturnType<typeof useModalDialog>;
