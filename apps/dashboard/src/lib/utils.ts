import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
 * `text-label`, `text-badge` et `text-desc` posent une police de texte :
 * tailwind-merge les rangerait sinon parmi les couleurs de texte, et une
 * couleur passée ensuite les retirerait.
 */
const merge = extendTailwindMerge({
  extend: { classGroups: { 'font-family': [{ text: ['label', 'badge', 'desc'] }] } },
});

/** Fusion de classes Tailwind sans conflit. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
