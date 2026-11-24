import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeError, stackExcerpt } from './error-stack';

/**
 * Erreurs pour le journal : nature en une ligne (avec la chaîne des causes)
 * et pile tronquée. Le journal doit dire d'où vient une erreur sans noyer
 * la ligne ni emporter des chemins absolus.
 */

/** Nombre de cadres demandées dans le test de troncature. */
const FRAMES = 2;

function inner(): Error {
  return new Error('origine');
}

function outer(): Error {
  return inner();
}

describe('describeError', () => {
  it('classe et message', () => {
    expect(describeError(new TypeError('réseau coupé'))).toBe('TypeError: réseau coupé');
  });

  it('la chaîne des causes est suivie : fetch emboute la vraie raison dans la sienne', () => {
    const error = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.example.test'), { code: 'ENOTFOUND' }) });
    expect(describeError(error)).toBe('TypeError: fetch failed ; causée par Error: getaddrinfo ENOTFOUND api.example.test');
  });

  it('la chaîne s\u0027arrête à trois causes : une boucle ne bloque pas', () => {
    const second = new Error('b');
    const first = new Error('a', { cause: second });
    (second as { cause?: unknown }).cause = first;
    expect(describeError(first)).toBe('Error: a ; causée par Error: b ; causée par Error: a ; causée par Error: b');
  });

  it('le message est tronqué, une valeur qui n\u0027est pas une erreur est rendue en texte', () => {
    expect(describeError(new Error('x'.repeat(400)))).toBe(`Error: ${'x'.repeat(173)}`);
    expect(describeError('x'.repeat(400))).toBe('x'.repeat(180));
    expect(describeError(undefined)).toBe('undefined');
  });
});

describe('stackExcerpt', () => {
  it('les cadres commencent au point de naissance de l\u0027erreur, en chemin relatif au dossier courant', () => {
    const excerpt = stackExcerpt(outer());
    expect(excerpt).toMatch(/^inner \(src\//u);
    expect(excerpt).toContain('outer (src/shared/utils/error-stack.spec.ts');
    expect(excerpt).not.toContain(process.cwd().replaceAll(sep, '/'));
    // Ligne unique : une ligne du journal JSONL reste une ligne.
    expect(excerpt).not.toContain('\n');
  });

  it('une cadre dans une dépendance est réduite à ses deux derniers segments ; un chemin relatif reste tel quel', () => {
    const synthetic = new Error('dans une dépendance');
    synthetic.stack = [
      'Error: dans une dépendance',
      '    at Object.run (file:///C:/Users/quelquun/projet/node_modules/.pnpm/vitest@1/node_modules/vitest/dist/chunks/run.js:1:2)',
      '    at C:\\Users\\quelquun\\projet\\apps\\bot\\src\\x.ts:3:4',
      '    at Object.handler (src/modules/tool-registry/tool-registry.service.ts:189:33)',
    ].join('\n');
    expect(stackExcerpt(synthetic)).toBe('Object.run (.../chunks/run.js:1:2) | .../src/x.ts:3:4 | Object.handler (src/modules/tool-registry/tool-registry.service.ts:189:33)');
  });

  it('seules les premières cadres sont gardées', () => {
    expect(stackExcerpt(outer(), FRAMES).split(' | ')).toHaveLength(FRAMES);
    expect(stackExcerpt(outer(), 50).split(' | ').length).toBeGreaterThanOrEqual(FRAMES);
  });

  it('une longue cadre est coupée, une ligne de message sur deux lignes n\u0027est pas une cadre', () => {
    const synthetic = new Error('sur deux lignes');
    synthetic.stack = `Error: première ligne\n    at ${'x'.repeat(300)} (file.ts:1:1)\ndeuxième ligne du message\n    at second (file.ts:2:2)`;
    expect(stackExcerpt(synthetic)).toBe(`${'x'.repeat(200)} | second (file.ts:2:2)`);
  });

  it('sans pile, rien', () => {
    expect(stackExcerpt('texte')).toBe('');
    expect(stackExcerpt(null)).toBe('');
    expect(stackExcerpt({ stack: 'pas une erreur' })).toBe('');
  });
});
