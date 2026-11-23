import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { MAX_INJECTED_TOOLS, selectRelevantTools, toolToOpenAiTool } from './tool-selection';

/**
 * Routage des tools : un agent sur-outillé sélectionne mal. Ces tests fixent
 * le contrat : noyau toujours présent, pertinence par mots partagés, plafond.
 */

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';

function tool(id: string, description = `tool ${id}`, category = 'test'): BotTool {
  return {
    [NAME]: id,
    description,
    category,
    paramsSchema: z.object({ q: z.string().optional() }),
    requiredModules: [],
    destructive: false,
    handler: async () => ({ ok: true, summary: 'ok' }),
  };
}

const names = (tools: BotTool[]): string[] => tools.map((entry) => entry.name);

describe('selectRelevantTools · noyau et pertinence', () => {
  it('le noyau est toujours inclus, même sans mot commun avec la demande', () => {
    const core = tool('getServerInfo', 'Infos serveur');
    const other = tool('test.weather', 'Météo locale');
    expect(names(selectRelevantTools('coucou', [core, other]))).toEqual(['getServerInfo']);
  });

  it('retient les tools dont le nom, la description ou la catégorie partagent un mot de la demande', () => {
    const translate = tool('translate', 'Traduit un texte vers la langue cible');
    const weather = tool('test.meteo', 'weather forecast', 'weather');
    expect(names(selectRelevantTools('traduis ce texte', [translate, weather]))).toEqual(['translate']);
    expect(names(selectRelevantTools('weather please', [translate, weather]))).toEqual(['test.meteo']);
  });

  it('plafonne les tools pertinents hors noyau', () => {
    const many = Array.from({ length: MAX_INJECTED_TOOLS + 6 }, (_, index) => tool(`test.weather${index}`, 'weather forecast'));
    expect(selectRelevantTools('weather', many)).toHaveLength(MAX_INJECTED_TOOLS);
  });

  it('rend tout quand rien ne correspond et qu\u0027il n\u0027y a pas de noyau', () => {
    const a = tool('test.aaa', 'aaa');
    const b = tool('test.bbb', 'bbb');
    expect(names(selectRelevantTools('zzz', [a, b]))).toEqual(['test.aaa', 'test.bbb']);
  });

  it('les mots de 3 lettres ou moins ne comptent pas', () => {
    const short = tool('test.xxx', 'le la les');
    const long = tool('test.yyy', 'bonjour');
    expect(names(selectRelevantTools('le bonjour', [short, long]))).toEqual(['test.yyy']);
  });
});

describe('toolToOpenAiTool · définition OpenAI', () => {
  it('porte le nom, la description et le schéma JSON des paramètres', () => {
    const openAi = toolToOpenAiTool(tool('translate', 'Traduit un texte'));
    expect(openAi.type).toBe('function');
    expect(openAi.function).toMatchObject({ [NAME]: 'translate', description: 'Traduit un texte' });
    expect(openAi.function.parameters).toMatchObject({ type: 'object' });
    expect(openAi.function.parameters).toHaveProperty('properties.q');
  });
});
