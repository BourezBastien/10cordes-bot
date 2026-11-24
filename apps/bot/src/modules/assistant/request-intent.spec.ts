import { describe, expect, it } from 'vitest';
import type { BotTool } from '@10cordes/shared';
import { detectRequestIntent } from './request-intent';

/**
 * Intention d'une demande, décidée avant son premier tour : elle choisit
 * l'effort de raisonnement et, depuis le moteur multi-fournisseurs, la
 * capacité de conversation (et donc le modèle). Une question de lecture ne
 * doit jamais passer pour une action.
 */

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';

const tool = (id: string): BotTool => ({ [NAME]: id, description: id, paramsSchema: {} } as unknown as BotTool);

const intent = (request: string, names: string[]) => detectRequestIntent(request, names.map(tool), []);

describe('detectRequestIntent · tools de lecture', () => {
  it.each(['provider.list', 'provider.models', 'provider.test', 'capability.list', 'providers.panel'])('%s ne signale pas une action', (id) => {
    expect(intent(`e2e : ${id}`, [id]).action).toBe(false);
  });

  it.each(['provider.upsert', 'provider.delete', 'capability.bind', 'records.create', 'rules.set'])('%s signale une action', (id) => {
    expect(intent(`e2e : ${id}`, [id])).toMatchObject({ action: true, mutatingTools: [id] });
  });

  it('une recette déclenchée signale une action, même sans tool modifiant', () => {
    expect(detectRequestIntent('lance une partie de blackjack', [], ['recette | blackjack']).action).toBe(true);
  });

  it('sans tool ni recette : simple conversation', () => {
    expect(intent('bonjour', [])).toMatchObject({ action: false, mutatingTools: [], matchedSkills: [] });
  });
});
