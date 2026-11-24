import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { BotTool, ToolRunContext } from '@10cordes/shared';
import { stringifySafe } from '../../shared/utils/object';
import { searchToolsTool, type ToolCatalog } from './tool-registry.builtin';

/**
 * search_tools étend le toolset actif : il ne doit annoncer que des tools que
 * l'appelant peut réellement exécuter, et ses cartes doivent survivre à la
 * troncature du résultat (4000 caractères) faite par la boucle.
 */

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';

/** Troncature appliquée par AgentLoopService au résultat de chaque tool. */
const TOOL_RESULT_MAX = 4000;

function tool(id: string, description: string, extra: Partial<BotTool> = {}): BotTool {
  return {
    [NAME]: id,
    description,
    category: 'test',
    paramsSchema: z.object({}),
    requiredModules: [],
    destructive: false,
    handler: async () => ({ ok: true, summary: 'ok' }),
    ...extra,
  };
}

const PANEL = tool('surface.create', 'Constructeur universel', {
  permissions: ['ManageGuild'],
  keywords: ['panneau', 'bouton'],
  systemPrompt: 'Consigne longue. '.repeat(20),
});
const WEATHER = tool('test.weather', 'weather forecast');
const ADMIN_ONLY = tool('test.admin', 'panneau reservé', { permissions: ['Administrator'], keywords: ['panneau'] });
const INACTIVE_MODULE = tool('test.off', 'panneau hors module', { keywords: ['panneau'] });

/** Catalogue dont seul un sous-ensemble est actif sur le serveur de l'appelant. */
function catalog(active: BotTool[]): ToolCatalog {
  return {
    list: () => [...active, INACTIVE_MODULE],
    listForGuild: async () => active,
  };
}

function ctx(permissions: string[] = []): ToolRunContext {
  return { guildId: 'guild-1', userId: 'user-1', locale: 'fr', permissions, reply: async () => {} };
}

interface Card {
  name: string;
  description: string;
  guidance: string | null;
}

const cardsOf = (result: { data?: Record<string, unknown> }): Card[] => (result.data?.tools as Card[] | undefined) ?? [];

async function search(tools: BotTool[], query: string, permissions: string[] = ['ManageGuild'], limit?: number): Promise<Card[]> {
  const result = await searchToolsTool(catalog(tools)).handler({ query, limit }, ctx(permissions));
  return cardsOf(result);
}

describe('search_tools · tools annoncés', () => {
  it('trouve un tool par mot-clé, même fléchi dans la requête', async () => {
    expect((await search([PANEL, WEATHER], 'panneaux')).map((card) => card.name)).toEqual(['surface.create']);
  });

  it('ne cherche que parmi les modules actifs du serveur', async () => {
    const names = (await search([PANEL, WEATHER], 'panneau')).map((card) => card.name);
    expect(names).toEqual(['surface.create']);
    expect(names).not.toContain('test.off');
  });

  it('n\u0027annonce pas un tool que l\u0027appelant n\u0027a pas le droit d\u0027exécuter', async () => {
    const member = (await search([PANEL, ADMIN_ONLY], 'panneau')).map((card) => card.name);
    expect(member).toEqual(['surface.create']);
    const admin = (await search([PANEL, ADMIN_ONLY], 'panneau', ['Administrator'])).map((card) => card.name).sort();
    expect(admin).toEqual(['surface.create', 'test.admin']);
  });

  it('sans correspondance, rend ok et aucune carte', async () => {
    const result = await searchToolsTool(catalog([PANEL])).handler({ query: 'zzzz' }, ctx());
    expect(result.ok).toBe(true);
    expect(cardsOf(result)).toEqual([]);
  });
});

describe('search_tools · cartes', () => {
  it('les cartes passent entières dans la troncature du résultat faite par la boucle', async () => {
    const many = Array.from({ length: 12 }, (_, index) => tool(`test.panel${index}`, 'Panneau', { keywords: ['panneau'], systemPrompt: 'Consigne. '.repeat(40) }));
    const result = await searchToolsTool(catalog(many)).handler({ query: 'panneau', limit: 12 }, ctx());
    // La boucle coupe le texte à 4000 caractères : seul le résumé doit en pâtir.
    const text = stringifySafe(result).slice(0, TOOL_RESULT_MAX);
    const summaryAt = text.indexOf(',"summary":');
    expect(summaryAt).toBeGreaterThan(0);
    const data = JSON.parse(`${text.slice(0, summaryAt)}}`) as { data: { tools: Card[] } };
    expect(data.data.tools).toHaveLength(12);
    for (const card of data.data.tools) {
      expect(card.description.length).toBeLessThanOrEqual(160);
      expect(card.guidance?.length ?? 0).toBeLessThanOrEqual(200);
    }
  });
});
