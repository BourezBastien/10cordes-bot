import type { ReactNode } from 'react';

/*
 * LOGIQUE DE LA LISTE DÉROULANTE, sans rendu : choix suivant, recherche par
 * les caractères tapés, placement de la liste, et la fermeture avalée du
 * dialogue qui la contient.
 */

export interface SelectOption<Value extends string = string> {
  value: Value;
  label: ReactNode;
  /** Texte de recherche, quand le libellé n'est pas une chaîne. */
  text?: string;
  disabled?: boolean;
}

export interface Spot {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  /** Contenant de la liste : le dialogue ouvert, sinon le corps. */
  into: HTMLElement;
}

type Options = ReadonlyArray<SelectOption<string>>;

/** Textes dans lesquels se fait la recherche : le libellé quand il est une chaîne, et le texte de recherche s'il est donné. */
function searchParts(option: SelectOption<string>): string[] {
  const parts = [typeof option.label === 'string' ? option.label : '', option.text ?? ''];
  return parts.filter(Boolean).map((part) => part.toLowerCase());
}

/** Index du prochain choix actif : saute les choix désactivés et revient au bout opposé. */
export function stepOption(options: Options, from: number, direction: 1 | -1): number {
  const count = options.length;
  if (count === 0) return -1;
  let index = from;
  for (let guard = 0; guard < count; guard += 1) {
    index = (index + direction + count) % count;
    if (!options[index]?.disabled) return index;
  }
  return from;
}

/** Première option, à partir de `start` exclu, dont le texte commence par `buffer` ; -1 s'il n'y en a pas. */
export function searchIndex(options: Options, buffer: string, start: number): number {
  const needle = buffer.toLowerCase();
  const count = options.length;
  if (count === 0) return -1;
  for (let step = 1; step <= count; step += 1) {
    const index = (start + step + count) % count;
    const option = options[index];
    if (option && !option.disabled && searchParts(option).some((part) => part.startsWith(needle))) return index;
  }
  return -1;
}

/**
 * Échap referme la liste sans refermer le dialogue qui la contient : la
 * fermeture demandée par la touche est avalée une fois, puis l'écouteur se
 * retire.
 */
export function swallowNextCancel(node: Element | null): void {
  const dialog = node?.closest('dialog');
  if (!dialog) return;
  const swallow = (event: Event) => event.preventDefault();
  dialog.addEventListener('cancel', swallow, { once: true });
  window.setTimeout(() => dialog.removeEventListener('cancel', swallow), 0);
}

/** Place la liste sous le bouton, ou au-dessus quand il ne reste pas la place dessous. */
export function spotOf(rect: DOMRect, viewportHeight: number, into: HTMLElement): Spot {
  const width = rect.width;
  const roomBelow = viewportHeight - rect.bottom - 12;
  const roomAbove = rect.top - 12;
  const below = roomBelow >= 160 || roomBelow >= roomAbove;
  return below
    ? { left: rect.left, width, top: rect.bottom + 4, into }
    : { left: rect.left, width, bottom: viewportHeight - rect.top + 4, into };
}
