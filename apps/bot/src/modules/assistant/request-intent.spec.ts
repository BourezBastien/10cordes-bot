import { describe, expect, it } from 'vitest';
import type { BotTool } from '@10cordes/shared';
import { detectRequestIntent } from './request-intent';

/**
 * Intention d'une demande, décidée avant son premier tour : elle choisit
 * l'effort de raisonnement et, depuis le moteur multi-fournisseurs, la
 * capacité de conversation (et donc le modèle). Une phrase banale ne doit
 * jamais passer pour une action, une demande d'action explicite toujours.
 */

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';

const tool = (id: string): BotTool => ({ [NAME]: id, description: id, paramsSchema: {} } as unknown as BotTool);

/** Tools modifiants que le routage injecte pour presque n'importe quelle phrase. */
const MUTATING = ['deleteChannel', 'provider.upsert', 'capability.bind', 'records.create', 'rules.set'];
const BLACKJACK = ['recette | blackjack'];

const intent = (request: string, names: string[] = [], skills: string[] = []) => detectRequestIntent(request, names.map(tool), skills);

describe('detectRequestIntent · tools nommés', () => {
  it.each(['provider.list', 'provider.models', 'provider.test', 'capability.list', 'providers.panel'])('%s nommé ne signale pas une action', (id) => {
    expect(intent(`e2e : ${id}`, [id])).toMatchObject({ action: false, signal: null });
  });

  it.each([
    'surface.get',
    'githubRepo',
    'voice.status',
    'jobs.list',
    'birthday.list',
    'channel.history.search',
    'members.export',
    'snipe',
    'http.fetch',
    'convertCurrency',
  ])('%s nommé ne signale pas une action : la classification le dit lecture, sans liste à tenir', (id) => {
    expect(intent(`e2e : ${id}`, [id])).toMatchObject({ action: false, signal: null });
  });

  it.each(['search_tools', 'search_skills', 'openSkill', 'translate', 'generateImage'])('%s nommé ne signale pas une action : outil direct', (id) => {
    expect(intent(`e2e : ${id}`, [id])).toMatchObject({ action: false, signal: null });
  });

  it.each(['renameChannel', 'sendMessage', 'reaction.add', 'voice.join', 'afk.set', 'node.set'])('%s nommé signale une action, sans être signalé destructif', (id) => {
    expect(intent(`e2e : ${id}`, [id])).toMatchObject({ action: true, signal: 'tool', mutatingTools: [id] });
  });

  it.each(['provider.upsert', 'provider.delete', 'capability.bind', 'records.create', 'rules.set'])('%s nommé signale une action', (id) => {
    expect(intent(`e2e : ${id}`, [id])).toMatchObject({ action: true, signal: 'tool', mutatingTools: [id] });
  });

  it('un tool modifiant routé mais non écrit dans la demande ne compte pas', () => {
    expect(intent('salut ça va', MUTATING)).toMatchObject({ action: false, mutatingTools: [] });
  });

  it('un nom plus long qui contient celui d\u0027un tool n\u0027est pas ce tool', () => {
    expect(intent('e2e : deleteChannels', ['deleteChannel']).action).toBe(false);
  });
});

describe('detectRequestIntent · conversation simple', () => {
  it.each([
    ['réponds exactement « sonnette-ok » et rien d\u0027autre', []],
    ['salut ça va', []],
    ['quelle heure est-il', []],
    ['quels fournisseurs IA sont configurés sur ce serveur ?', []],
    ['montre-moi la configuration', []],
    ['comment supprimer un salon ?', []],
    ['c\u0027est quoi la recette blackjack ?', BLACKJACK],
    ['est-ce que tu aimes les bananes ?', []],
    ['ça va mettre combien de temps ?', []],
    ['tu mets quoi dans ton café ?', []],
    ['respecte la règle du serveur', []],
    ['la règle active du serveur', []],
    ['je suis mute en fait', []],
    ['Paul est à son poste', []],
    ['un clone du serveur d\u0027à côté', []],
    ['le programme de la soirée', []],
    ['quelle est la limite ?', []],
  ])('« %s » reste une conversation', (request, skills) => {
    expect(intent(request, MUTATING, skills)).toMatchObject({ action: false, signal: null, matchedSkills: [] });
  });

  it.each([
    ['pourrais-tu m\u0027expliquer comment supprimer un salon ?', 'la question porte sur le savoir-faire'],
    ['est-ce que je peux créer un salon ?', 'la question porte sur le droit de l\u0027utilisateur'],
  ])('« %s » reste une conversation : %s', (request) => {
    expect(intent(request, MUTATING).action).toBe(false);
  });
});

describe('detectRequestIntent · actions', () => {
  it.each([
    'supprime le salon général',
    '@10cordes crée un salon test-plan et supprime-le',
    'est-ce que tu peux créer un système de tickets ?',
    'salut, est-ce que vous pouvez fermer le salon #ancien ?',
    'peux-tu planifier un rappel dans 10 minutes ?',
    'pourrais-tu renommer #général en #accueil',
    'édite le titre du panneau',
    'épingler ce message',
    'mets à jour le panneau de tickets',
    'mets en place un système de rappels',
    'règle la capacité chat.default sur le modèle X',
    'regle le thinking en mode off',
    'Réglons le thinking en mode off',
    'il faut que tu actives la règle',
    'on peut bannir les comptes spam ?',
    'ban Paul',
    'fais que Paul ait accès au salon vocal',
    'donne le rôle Modo à Paul',
    'delete the channel #test',
  ])('« %s » est une action', (request) => {
    expect(intent(request, [], BLACKJACK)).toMatchObject({ action: true, signal: 'verb' });
  });

  it('une demande d\u0027action nomme aussi son tool', () => {
    expect(intent('active la règle de confirmation des actions destructives (rules.set)', ['rules.set'])).toMatchObject({
      action: true,
      signal: 'tool',
      mutatingTools: ['rules.set'],
    });
  });

  it('une recette déclenchée signale une action, même sans verbe ni tool modifiant', () => {
    expect(intent('une partie de blackjack', [], BLACKJACK)).toMatchObject({ action: true, signal: 'skill', matchedSkills: BLACKJACK });
  });

  it('une question sur une recette ne la déclenche pas', () => {
    expect(intent('comment jouer au blackjack ?', [], BLACKJACK)).toMatchObject({ action: false, matchedSkills: [] });
  });

  it('sans tool ni recette ni verbe : simple conversation', () => {
    expect(intent('bonjour')).toMatchObject({ action: false, signal: null, mutatingTools: [], matchedSkills: [] });
  });
});
