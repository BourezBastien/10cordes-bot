import { describe, expect, it } from 'vitest';
import { validateStepReferences, type ConditionSpec, type PipelineStep } from '../src/index.js';

/**
 * Références `{{steps.N.<champ>}}` d'un pipeline. À l'exécution, une
 * référence qui ne résout pas devient une chaîne vide, sans erreur : un
 * panneau de tickets accepté avec `{{steps.0.data.id}}` donnait un bouton
 * muet au clic. Ces tests fixent la règle, et la manière dont l'exécuteur
 * numérote vraiment ses étapes : l'exécuteur tient UN tableau partagé, où
 * chaque étape se range APRÈS l'exécution de ses sous-pipelines.
 */

const runTool = (name: string, input: Record<string, unknown> = {}): PipelineStep => ({ type: 'runTool', name, input });
const say = (content: string): PipelineStep => ({ type: 'sendMessage', content });
const noOwner: ConditionSpec = { kind: 'state', path: 'owner', op: 'exists' };
const branch = (then: PipelineStep[], otherwise?: PipelineStep[]): PipelineStep => ({ type: 'if', condition: noOwner, then, ...(otherwise ? { else: otherwise } : {}) });
const loop = (steps: PipelineStep[]): PipelineStep => ({ type: 'forEach', over: 'roleMembers', limit: 5, steps });
const later = (steps: PipelineStep[]): PipelineStep => ({ type: 'trigger.schedule', delaySec: 60, steps });

const SHIFTED = 'Range la valeur dans l\u0027état (setState) et lis-la par {{state.x}}';
const NO_NUMBER = 'numéro d\u0027étape attendu, sous la forme {{steps.0.<champ>}}.';

describe('validateStepReferences · ce qui passe', () => {
  it('aucune référence d\u0027étape : l\u0027état, l\u0027acteur, la surface ne sont pas concernés', () => {
    expect(
      validateStepReferences(
        [runTool('createChannel', { name: 'Tickets {{state.index}}' }), say('Salon pour {{actor.username}} dans {{guild.id}} (surface {{surface.channelId}})')],
        'test',
      ),
    ).toEqual([]);
  });

  it('le résultat d\u0027un outil se lit dans une étape ANTÉRIEURE, champ à plat, espaces tolérés', () => {
    expect(validateStepReferences([runTool('createChannel'), say('<#{{steps.0.channelId}}>'), { type: 'replyEphemeral', content: '{{ steps.0.id }} ouvert' }], 'test')).toEqual([]);
  });

  it('les références d\u0027un champ imbriqué (objet, tableau) sont lues et nommées par leur chemin', () => {
    const good: PipelineStep[] = [runTool('members.pickRandom'), runTool('sendMessage', { to: ['{{steps.0.userId}}'], note: { for: '{{steps.0.userId}}' } })];
    const bad: PipelineStep[] = [runTool('members.pickRandom'), runTool('sendMessage', { to: ['{{steps.2.userId}}'], note: { for: '{{steps.0.userId}}' } })];
    expect(validateStepReferences(good, 'test')).toEqual([]);
    expect(validateStepReferences(bad, 'test')).toEqual([
      '{{steps.2.userId}} dans input.to.0, test, étape 2 (runTool) : l\u0027étape 2 n\u0027existe pas encore à cette position (étapes lisibles à cet endroit : 0 à 0).',
    ]);
  });

  it('un « if » en tête de pipeline : sa branche lit ses propres étapes depuis 0', () => {
    expect(validateStepReferences([branch([runTool('createChannel'), say('<#{{steps.0.channelId}}>')])], 'test')).toEqual([]);
  });

  it('la branche d\u0027un « if » lit les étapes d\u0027avant le « if » et les siennes, avec les numéros du tableau partagé', () => {
    // Étape 0 : création du salon. Le « if » est en position 1 : la création DANS la branche se range à l\u0027index 1.
    const pipeline = [runTool('createChannel'), branch([runTool('createChannel'), say('<#{{steps.0.channelId}}> puis <#{{steps.1.channelId}}>')], [say('<#{{steps.0.channelId}}>')])];
    expect(validateStepReferences(pipeline, 'test')).toEqual([]);
  });

  it('un pipeline planifié repart de zéro : il ne lit que ses propres étapes', () => {
    expect(validateStepReferences([runTool('createChannel'), later([runTool('sendMessage'), say('fait {{steps.0.sent}}')])], 'test')).toEqual([]);
  });

  it('le corps d\u0027une boucle lit les étapes d\u0027avant la boucle', () => {
    expect(validateStepReferences([runTool('createChannel'), loop([runTool('sendMessage', { content: '<#{{steps.0.channelId}}>' })])], 'test')).toEqual([]);
  });

  it('après un premier « if », les étapes d\u0027avant lui restent lisibles partout', () => {
    const pipeline = [runTool('createChannel'), branch([say('a')]), branch([say('<#{{steps.0.channelId}}>')])];
    expect(validateStepReferences(pipeline, 'test')).toEqual([]);
  });
});

describe('validateStepReferences · ce qui est refusé, et pourquoi', () => {
  it('{{steps.N.data.x}} : le résultat se lit sans data', () => {
    expect(validateStepReferences([runTool('createChannel'), say('<#{{steps.0.data.id}}>')], 'bouton « ouvrir »')).toEqual([
      '{{steps.0.data.id}} dans content, bouton « ouvrir », étape 2 (sendMessage) : le résultat d\u0027un outil se lit sans `data` : le champ se met directement après le numéro.',
    ]);
    expect(validateStepReferences([runTool('createChannel'), say('{{steps.0.data}}')], 'test')).toHaveLength(1);
  });

  it('une étape postérieure ou inexistante : le numéro fautif et la plage lisible sont nommés', () => {
    expect(validateStepReferences([say('{{steps.1.channelId}}'), runTool('createChannel'), say('{{steps.5.channelId}} {{steps.1.channelId}}')], 'test')).toEqual([
      '{{steps.1.channelId}} dans content, test, étape 1 (sendMessage) : l\u0027étape 1 n\u0027existe pas encore à cette position (aucune étape n\u0027est lisible ici).',
      '{{steps.5.channelId}} dans content, test, étape 3 (sendMessage) : l\u0027étape 5 n\u0027existe pas encore à cette position (étapes lisibles à cet endroit : 0 à 1).',
    ]);
  });

  it('une branche ne lit pas une étape qui n\u0027y est pas encore : ses propres étapes comptent', () => {
    // Dans la branche, l\u0027index 2 est l\u0027étape qui parle elle-même : elle n\u0027a pas encore de résultat.
    expect(validateStepReferences([runTool('createChannel'), branch([runTool('createChannel'), say('<#{{steps.2.channelId}}>')])], 'test')).toEqual([
      '{{steps.2.channelId}} dans content, test, étape 2 (if), branche alors, étape 2 (sendMessage) : l\u0027étape 2 n\u0027existe pas encore à cette position (étapes lisibles à cet endroit : 0 à 1).',
    ]);
  });

  it('après un « if », ses étapes et les suivantes n\u0027ont pas de numéro fixe ; celles d\u0027avant restent lisibles', () => {
    const pipeline = [runTool('createChannel'), branch([runTool('sendMessage')]), runTool('sendMessage', { channelId: '{{steps.0.channelId}}', content: '<#{{steps.1.channelId}}>' })];
    expect(validateStepReferences(pipeline, 'test')).toEqual([
      `{{steps.1.channelId}} dans input.content, test, étape 3 (runTool) : les étapes d\u0027un « if » ou d\u0027un « forEach », et celles qui les suivent, n\u0027ont pas de numéro fixe (il dépend de la branche prise ou du nombre de tours). ${SHIFTED} (étapes lisibles à cet endroit : 0 à 0).`,
    ]);
  });

  it('une branche d\u0027un second « if » ne lit pas une étape située après le premier', () => {
    const pipeline = [branch([say('a')]), runTool('createChannel'), branch([say('{{steps.1.channelId}}')])];
    expect(validateStepReferences(pipeline, 'test')).toEqual([
      `{{steps.1.channelId}} dans content, test, étape 3 (if), branche alors, étape 1 (sendMessage) : les étapes d\u0027un « if » ou d\u0027un « forEach », et celles qui les suivent, n\u0027ont pas de numéro fixe (il dépend de la branche prise ou du nombre de tours). ${SHIFTED} (aucune étape n\u0027est lisible ici).`,
    ]);
  });

  it('dans le corps d\u0027un « forEach », seules les étapes d\u0027avant la boucle sont lisibles', () => {
    const pipeline = [runTool('createChannel'), loop([runTool('sendMessage', { content: '<#{{steps.0.channelId}}>' }), say('{{steps.1.channelId}}')])];
    expect(validateStepReferences(pipeline, 'test')).toEqual([
      `{{steps.1.channelId}} dans content, test, étape 2 (forEach), corps de boucle, étape 2 (sendMessage) : dans ou après un « forEach », chaque tour ajoute ses étapes au même tableau : ce numéro n\u0027est pas fixe. ${SHIFTED} (étapes lisibles à cet endroit : 0 à 0).`,
    ]);
  });

  it('après la boucle non plus : chaque tour a décalé les étapes', () => {
    const pipeline = [runTool('createChannel'), loop([runTool('sendMessage')]), say('<#{{steps.1.channelId}}>')];
    const [error] = validateStepReferences(pipeline, 'test');
    expect(error).toContain('{{steps.1.channelId}} dans content, test, étape 3 (sendMessage) : les étapes d\u0027un « if » ou d\u0027un « forEach », et celles qui les suivent, n\u0027ont pas de numéro fixe');
  });

  it('un pipeline planifié ne peut pas lire les étapes de celui qui l\u0027a créé', () => {
    const pipeline = [runTool('createChannel'), later([say('<#{{steps.0.channelId}}>')])];
    expect(validateStepReferences(pipeline, 'test')).toEqual([
      '{{steps.0.channelId}} dans content, test, étape 2 (trigger.schedule), pipeline planifié, étape 1 (sendMessage) : l\u0027étape 0 n\u0027existe pas encore à cette position (aucune étape n\u0027est lisible ici).',
    ]);
  });

  it('une référence sans numéro est refusée, plutôt que de rendre une chaîne vide', () => {
    const pipeline = [runTool('createChannel'), say('{{steps.channelId}} et {{steps.x.id}}, {{steps}}')];
    const errors = validateStepReferences(pipeline, 'test');
    expect(errors).toHaveLength(3);
    expect(errors.every((error) => error.includes(NO_NUMBER))).toBe(true);
  });

  it('la condition d\u0027un « if » est vérifiée comme les autres champs', () => {
    const condition: ConditionSpec = { kind: 'state', path: 'owner', op: 'eq', value: '{{steps.3.channelId}}' };
    expect(validateStepReferences([runTool('createChannel'), { type: 'if', condition, then: [say('ok')] }], 'test')).toEqual([
      '{{steps.3.channelId}} dans condition.value, test, étape 2 (if) : l\u0027étape 3 n\u0027existe pas encore à cette position (étapes lisibles à cet endroit : 0 à 0).',
    ]);
  });

  it('la clé d\u0027annulation d\u0027un déclencheur planifié est vérifiée, dans le pipeline qui la porte', () => {
    const pipeline: PipelineStep[] = [later([{ type: 'trigger.cancelByKey', key: 'ticket-{{steps.0.channelId}}' }])];
    const [error] = validateStepReferences(pipeline, 'test');
    expect(error).toContain('test, étape 1 (trigger.schedule), pipeline planifié, étape 1 (trigger.cancelByKey) : l\u0027étape 0 n\u0027existe pas encore');
  });
});
