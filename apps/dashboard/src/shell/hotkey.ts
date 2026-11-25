import { useEffect, useRef } from 'react';

/*
 * TOUCHE DE RECHERCHE. `/` ouvre la palette, ainsi que Ctrl+K (Cmd+K sur
 * macOS). La touche est ignorée quand on tape dans un champ, pendant une
 * saisie composée (IME), ou depuis un élément qui a déjà traité la touche.
 */

export function useSearchHotkey(onOpen: () => void): void {
  const handler = useRef(onOpen);
  handler.current = onOpen;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]') !== null;
      if (typing) return;
      const plain = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
      const palette = (event.key === 'k' || event.key === 'K') && (event.ctrlKey || event.metaKey);
      if ((!plain && !palette) || event.isComposing || event.defaultPrevented || event.repeat) return;
      event.preventDefault();
      handler.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
