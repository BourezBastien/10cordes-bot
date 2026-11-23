import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { describeDefinitionError, describeIssues, listBindingKeys, surfaceNotFound } from './surface.errors';
import type { SurfaceDefinition } from '@10cordes/shared';

// Forme réelle du schéma : une rangée select n'a pas de clé propre, ses
// OPTIONS sont les bindings (même règle que SurfaceService.findBinding).
const definition = {
  title: 'Sondage',
  description: 'un vote par personne',
  rows: [
    { kind: 'buttons', buttons: [{ key: 'vote-alpha', label: 'Alpha', style: 'primary', pipeline: [] }] },
    { kind: 'select', select: { placeholder: 'choisis', options: [{ key: 'opt-1', label: 'Option 1', pipeline: [] }] } },
  ],
} as unknown as SurfaceDefinition;

describe('describeIssues / describeDefinitionError', () => {
  it('donne le chemin du champ fautif, pas seulement le motif', () => {
    const parsed = z.object({ rows: z.array(z.object({ kind: z.enum(['buttons', 'select']) })) }).safeParse({ rows: [{ kind: 'button' }] });
    if (parsed.success) throw new Error('attendu : un échec de validation');
    expect(describeDefinitionError(parsed.error)).toBe("rows.0.kind : Invalid option: expected one of \"buttons\"|\"select\"");
  });

  it('limite le nombre d\u0027erreurs listées', () => {
    const parsed = z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string() }).safeParse({});
    if (parsed.success) throw new Error('attendu : un échec de validation');
    const text = describeDefinitionError(parsed.error);
    expect(text.split(' | ')).toHaveLength(3);
    expect(text).toContain('a :');
    expect(text).not.toContain('d :');
    expect(describeIssues(parsed.error, 4).split(' | ')).toHaveLength(4);
  });

  it('explique un JSON mal formé', () => {
    try {
      JSON.parse('{"title": ');
    } catch (error) {
      expect(describeDefinitionError(error)).toMatch(/^JSON illisible \(/u);
    }
  });
});

describe('listBindingKeys', () => {
  it('liste les clés des boutons et des options de select, dans l\u0027ordre', () => {
    expect(listBindingKeys(definition)).toEqual(['vote-alpha', 'opt-1']);
  });
});

describe('surfaceNotFound', () => {
  it('sans identifiant : dit quoi fournir', () => {
    expect(surfaceNotFound(undefined, undefined)).toContain('fournis surfaceId');
  });
  it('avec un identifiant inconnu : le rappelle et oriente', () => {
    expect(surfaceNotFound('abc', undefined)).toContain('aucun surfaceId « abc »');
    expect(surfaceNotFound(undefined, '123')).toContain('aucun messageId « 123 »');
  });
});
