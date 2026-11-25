import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalDialog } from '@/ds/use-modal-dialog';

/*
 * MENU « PLUS ». Sous 1280 px, le sélecteur de serveur, les pages secondaires,
 * la langue et la déconnexion vivent ici : un panneau plein écran sous la
 * barre haute, en dialogue modal natif (le fond est inerte, Échap referme).
 * Un lien referme le panneau avant de naviguer.
 */

export interface MorePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sélecteur de serveur, ou rien hors d'un serveur. */
  switcher: ReactNode;
  /** Les pages du serveur ; reçoit de quoi refermer le panneau. */
  pages: (close: () => void) => ReactNode;
  footer: ReactNode;
}

export function MorePanel({ open, onOpenChange, switcher, pages, footer }: MorePanelProps) {
  const { t } = useTranslation();
  const { ref, close, dialogProps } = useModalDialog({ open, onClosed: () => onOpenChange(false), locked: false });
  return (
    <dialog
      ref={ref}
      aria-label={t('nav.more')}
      className="m-0 mt-14 h-[calc(100dvh-56px)] max-h-none w-full max-w-full border-0 border-t-2 border-edge bg-panel-deep text-ink anim-slide"
      {...dialogProps}
    >
      <div className="flex h-full flex-col gap-5 overflow-y-auto px-4 py-5">
        {switcher ? <div className="xl:hidden">{switcher}</div> : null}
        <nav aria-label={t('nav.more')}>{pages(close)}</nav>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-4">{footer}</div>
      </div>
    </dialog>
  );
}
