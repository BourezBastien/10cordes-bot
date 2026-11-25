import { describe, expect, it } from 'vitest';
import { carries, correctionLine, enforceCorrections, tokensOf } from './memory-correction.matcher';

/*
 * Rapprochement d'un fait avec un texte : ce qui fait qu'une entrée du
 * journal porte un fait périmé, et ce qu'une fiche doit quand une fusion a
 * laissé tomber une correction.
 */

describe('tokensOf', () => {
  it('met de côté la casse, les accents, les mots de liaison, et ramène à un radical', () => {
    expect(tokensOf('Habite à Lille, DÉMÉNAGÉ depuis Mars').join(' ')).toBe('habit lille demen depui mars');
  });

  it('un texte sans mot significatif ne donne rien', () => {
    expect(tokensOf('il est là pour nous')).toEqual([]);
    expect(tokensOf('')).toEqual([]);
  });
});

describe('carries', () => {
  it('reconnaît une reformulation : casse, accents, conjugaison, mots ajoutés', () => {
    expect(carries('<@123> habite à Lille depuis 2020', 'habite à Lille')).toBe(true);
    expect(carries('LILLE : Bastien y habite', 'Habite à lille')).toBe(true);
    expect(carries('Bastien a déménagé à Lyon en mars', 'a déménagé à Lyon')).toBe(true);
  });

  it('ne reconnaît pas un fait dont un mot significatif manque', () => {
    expect(carries('<@123> habite à Lyon depuis 2020', 'habite à Lille')).toBe(false);
    expect(carries('a visité Lille en 2020', 'habite à Lille')).toBe(false);
  });

  it('un fait trop court n\u0027entraîne rien : on ne retire pas à un seul mot', () => {
    expect(carries('a visité Lille', 'Lille')).toBe(false);
    expect(carries('un mot', 'un')).toBe(false);
  });

  it('un mot long ne se confond pas avec un autre de même radical court', () => {
    expect(carries('travaille comme boulanger', 'travaille comme journaliste')).toBe(false);
  });
});

describe('correctionLine', () => {
  it('dit la forme corrigée, et ce qu\u0027elle remplace', () => {
    expect(correctionLine({ oldFact: 'habite à Lille', newFact: 'habite à Lyon' })).toBe('CORRIGÉ : habite à Lyon (ne plus dire : habite à Lille)');
  });
});

describe('enforceCorrections', () => {
  const correction = { oldFact: 'habite à Lille', newFact: 'habite à Lyon' };

  it('laisse une fiche qui porte déjà la forme corrigée', () => {
    expect(enforceCorrections('<@123> habite à Lyon.', [correction], 2000)).toBe('<@123> habite à Lyon.');
  });

  it('laisse une fiche qui ne parle pas de ce fait', () => {
    expect(enforceCorrections('<@123> aime les pizzas.', [correction], 2000)).toBe('<@123> aime les pizzas.');
  });

  it('réécrit la correction quand la fusion a laissé l\u0027ancien fait', () => {
    expect(enforceCorrections('<@123> habite à Lille.', [correction], 2000)).toBe('<@123> habite à Lille.\nCORRIGÉ : habite à Lyon (ne plus dire : habite à Lille)');
  });

  it('dans le budget : ce qui précède cède la place, jamais la correction', () => {
    const line = '\nCORRIGÉ : habite à Lyon (ne plus dire : habite à Lille)';
    const result = enforceCorrections(`<@123> habite à Lille. ${'a'.repeat(150)}`, [correction], 180);
    expect(result.length).toBe(180);
    expect(result.endsWith(line)).toBe(true);
    expect(result.startsWith('<@123> habite à Lille.')).toBe(true);
    // Une correction qui ne tiendrait pas seule dans le budget n'est pas ajoutée.
    expect(enforceCorrections('habite à Lille', [correction], 20)).toBe('habite à Lille');
  });
});
