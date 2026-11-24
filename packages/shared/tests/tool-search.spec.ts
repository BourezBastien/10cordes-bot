import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { rankTools, toolMatchScore, wordsOf, type BotTool } from '../src/index.js';

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';

function tool(id: string, description: string, keywords: string[] = []): BotTool {
  return {
    [NAME]: id,
    description,
    category: 'test',
    keywords,
    paramsSchema: z.object({}),
    requiredModules: [],
    destructive: false,
    handler: async () => ({ ok: true, summary: 'ok' }),
  };
}

describe('wordsOf', () => {
  it('garde les mots assez longs, en minuscules et sans doublon', () => {
    expect(wordsOf('Un Panneau, un PANNEAU et des boutons', 4)).toEqual(['panneau', 'boutons']);
  });

  it('reconnaît les lettres accentuées comme des lettres', () => {
    expect(wordsOf('créer un système', 4)).toEqual(['créer', 'système']);
  });
});

describe('toolMatchScore', () => {
  const panel = tool('test.build', 'Construit une interface', ['panneau', 'bouton']);

  it('pèse le nom plus lourd que la description', () => {
    const byName = toolMatchScore(tool('test.build', 'autre chose'), ['build']);
    const byText = toolMatchScore(tool('test.other', 'build thing'), ['build']);
    expect(byName).toBe(3);
    expect(byText).toBe(1);
  });

  it('un mot-clé racine couvre ses formes fléchies', () => {
    expect(toolMatchScore(panel, ['panneaux'])).toBe(2);
    expect(toolMatchScore(panel, ['boutons'])).toBe(2);
  });

  it('un mot qui ne fait que contenir un mot-clé ne compte pas', () => {
    expect(toolMatchScore(panel, ['spanneau'])).toBe(0);
  });

  it('sans mots-clés ni mot commun, le score est nul', () => {
    expect(toolMatchScore(panel, ['météo'])).toBe(0);
  });
});

describe('rankTools', () => {
  it('classe par score décroissant et écarte les scores nuls', () => {
    const byKeyword = tool('test.k', 'rien', ['ticket']);
    const byName = tool('test.tickets', 'rien');
    const byText = tool('test.t', 'tickets');
    const none = tool('test.z', 'rien');
    expect(rankTools([none, byText, byKeyword, byName], ['tickets'], 10).map((entry) => entry.name)).toEqual([
      'test.tickets',
      'test.k',
      'test.t',
    ]);
  });

  it('respecte la limite', () => {
    const many = Array.from({ length: 5 }, (_, index) => tool(`test.a${index}`, 'weather'));
    expect(rankTools(many, ['weather'], 2)).toHaveLength(2);
  });
});
