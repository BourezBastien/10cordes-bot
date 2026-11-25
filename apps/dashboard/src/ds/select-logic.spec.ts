import { describe, expect, it } from 'vitest';
import { searchIndex, spotOf, stepOption } from '@/ds/select-logic';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo', disabled: true },
  { value: 'c', label: 'Charlie' },
  { value: 'd', label: 'Delta', text: 'echo' },
];

describe('stepOption', () => {
  it(' avance d’un cran et saute les choix désactivés', () => {    expect(stepOption(OPTIONS, 0, 1)).toBe(2);
    expect(stepOption(OPTIONS, 2, 1)).toBe(3);
  });

  it('recule aussi', () => {
    expect(stepOption(OPTIONS, 2, -1)).toBe(0);
  });

  it('revient au bout opposé', () => {
    expect(stepOption(OPTIONS, 3, 1)).toBe(0);
    expect(stepOption(OPTIONS, 0, -1)).toBe(3);
    expect(stepOption(OPTIONS, -1, 1)).toBe(0);
  });

  it('rend -1 sans option, et reste sur place si tout est désactivé', () => {
    expect(stepOption([], 0, 1)).toBe(-1);
    expect(stepOption([{ value: 'x', label: 'X', disabled: true }], 0, 1)).toBe(0);
  });
});

describe('searchIndex', () => {
  it('trouve la première option qui commence par les caractères tapés', () => {
    expect(searchIndex(OPTIONS, 'ch', -1)).toBe(2);
    expect(searchIndex(OPTIONS, 'ALPHA', -1)).toBe(0);
  });

  it('cherche à partir du choix actif, exclus, et revient au début', () => {
    expect(searchIndex(OPTIONS, 'a', 0)).toBe(0);
    expect(searchIndex(OPTIONS, 'c', 3)).toBe(2);
  });

  it('utilise le texte de recherche quand le libellé n’est pas une chaîne', () => {
    expect(searchIndex(OPTIONS, 'ec', -1)).toBe(3);
  });

  it('ignore les choix désactivés et rend -1 sans suite', () => {
    expect(searchIndex(OPTIONS, 'b', -1)).toBe(-1);
    expect(searchIndex(OPTIONS, 'zz', -1)).toBe(-1);
  });
});

describe('spotOf', () => {
  const into = {} as HTMLElement;

  it('place la liste sous le bouton quand il reste la place', () => {
    const rect = { left: 100, width: 240, top: 200, bottom: 244 } as DOMRect;
    expect(spotOf(rect, 800, into)).toEqual({ left: 100, width: 240, top: 248, into });
  });

  it('place la liste au-dessus quand le bas de l’écran est trop bas', () => {
    const rect = { left: 100, width: 240, top: 650, bottom: 694 } as DOMRect;
    expect(spotOf(rect, 720, into)).toEqual({ left: 100, width: 240, bottom: 74, into });
  });

  it('reste en dessous si le haut est encore plus étroit', () => {
    const rect = { left: 0, width: 10, top: 40, bottom: 500 } as DOMRect;
    expect(spotOf(rect, 720, into).top).toBe(504);
  });
});
