import { describe, expect, it } from 'vitest';
import { filterDestinations, fold, type Destination } from '@/shell/search-palette';

const go = () => undefined;
const ITEMS: Destination[] = [
  { key: 'providers', group: 'pages', label: 'IA', hint: 'fournisseurs modèles', go },
  { key: 'rules', group: 'pages', label: 'Règles', hint: 'zones libres silence', go },
  { key: 'guild-1', group: 'servers', label: 'Les Cordées', go },
  { key: 'guild-2', group: 'servers', label: 'Dev Box', go },
];

describe('fold', () => {
  it('retire la casse et les accents', () => {
    expect(fold('Règles')).toBe('regles');
    expect(fold('  ÉCOLE  ')).toBe('  ecole  ');
  });
});

describe('filterDestinations', () => {
  it('rend tout pour une requête vide', () => {
    expect(filterDestinations(ITEMS, '')).toHaveLength(4);
    expect(filterDestinations(ITEMS, '   ')).toHaveLength(4);
  });

  it('cherche sans casse ni accents', () => {
    expect(filterDestinations(ITEMS, 'regles').map((item) => item.key)).toEqual(['rules']);
  });

  it('cherche aussi dans l’indice, et garde les pages avant les serveurs', () => {
    expect(filterDestinations(ITEMS, 'modeles').map((item) => item.key)).toEqual(['providers']);
  });

  it('exige tous les mots', () => {
    expect(filterDestinations(ITEMS, 'zones silence').map((item) => item.key)).toEqual(['rules']);
    expect(filterDestinations(ITEMS, 'zones modeles')).toEqual([]);
  });

  it('rend rien quand rien ne correspond', () => {
    expect(filterDestinations(ITEMS, 'zzz')).toEqual([]);
  });
});
