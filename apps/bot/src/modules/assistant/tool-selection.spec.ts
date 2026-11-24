import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { MAX_INJECTED_TOOLS, TOOL_CORE_NAMES, pinnedToolGuidance, selectRelevantTools, toolToOpenAiTool } from './tool-selection';

/**
 * Routage des tools : un agent sur-outillé sélectionne mal. Ces tests fixent
 * le contrat : noyau toujours présent, pertinence par mots partagés, plafond.
 */

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';

function tool(id: string, description = `tool ${id}`, extra: Partial<BotTool> = {}): BotTool {
  return {
    [NAME]: id,
    description,
    category: 'test',
    paramsSchema: z.object({ q: z.string().optional() }),
    requiredModules: [],
    destructive: false,
    handler: async () => ({ ok: true, summary: 'ok' }),
    ...extra,
  };
}

const names = (tools: BotTool[]): string[] => tools.map((entry) => entry.name);

describe('selectRelevantTools · noyau et pertinence', () => {
  it('le noyau est toujours inclus, même sans mot commun avec la demande', () => {
    const core = tool('getServerInfo', 'Infos serveur');
    const other = tool('test.weather', 'Météo locale');
    expect(names(selectRelevantTools('coucou', [core, other]))).toEqual(['getServerInfo']);
  });

  it('les primitives du moteur générique sont épinglées dans le noyau', () => {
    for (const name of ['surface.create', 'surface.patchState', 'surface.updateComponent', 'trigger.schedule', 'trigger.cancelByKey', 'search_skills']) {
      expect(TOOL_CORE_NAMES.has(name)).toBe(true);
    }
    expect(TOOL_CORE_NAMES.has('surface.get')).toBe(false);
  });

  it('l\u0027outil d\u0027annonce d\u0027étape n\u0027est plus au noyau : rien ne s\u0027affiche pendant une demande', () => {
    expect(TOOL_CORE_NAMES.has('announceStep')).toBe(false);
    expect(TOOL_CORE_NAMES.size).toBe(19);
  });

  it('retient les tools dont le nom, la description ou la catégorie partagent un mot de la demande', () => {
    const translate = tool('translate', 'Traduit un texte vers la langue cible');
    const weather = tool('test.meteo', 'weather forecast', { category: 'weather' });
    expect(names(selectRelevantTools('traduis ce texte', [translate, weather]))).toEqual(['translate']);
    expect(names(selectRelevantTools('weather please', [translate, weather]))).toEqual(['test.meteo']);
  });

  it('un mot-clé racine route le tool, même fléchi dans la demande', () => {
    const panel = tool('test.build', 'Construit une interface', { keywords: ['panneau', 'bouton'] });
    const other = tool('test.other', 'rien à voir');
    expect(names(selectRelevantTools('je veux des panneaux svp', [panel, other]))).toEqual(['test.build']);
  });

  it('plafonne les tools pertinents hors noyau', () => {
    const many = Array.from({ length: MAX_INJECTED_TOOLS + 6 }, (_, index) => tool(`test.weather${index}`, 'weather forecast'));
    expect(selectRelevantTools('weather', many)).toHaveLength(MAX_INJECTED_TOOLS);
  });

  it('le noyau ne compte pas dans le plafond', () => {
    const many = Array.from({ length: MAX_INJECTED_TOOLS + 6 }, (_, index) => tool(`test.weather${index}`, 'weather forecast'));
    const core = [tool('getServerInfo', 'Infos serveur'), tool('surface.create', 'Panneau')];
    const kept = selectRelevantTools('weather', [...core, ...many]);
    expect(kept).toHaveLength(MAX_INJECTED_TOOLS + core.length);
    expect(names(kept).slice(-core.length)).toEqual(['getServerInfo', 'surface.create']);
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

describe('pinnedToolGuidance · consignes des primitives', () => {
  it('rend la consigne des tools épinglés qui en ont une, et rien d\u0027autre', () => {
    const tools = [
      tool('surface.create', 'Panneau', { systemPrompt: 'rows = tableau.' }),
      tool('getServerInfo', 'Infos'),
      tool('test.other', 'Hors noyau', { systemPrompt: 'Ne doit pas apparaître.' }),
    ];
    expect(pinnedToolGuidance(tools)).toEqual(['surface.create : rows = tableau.']);
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
