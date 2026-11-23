import { describe, expect, it } from 'vitest';
import { PipelineInterpolator } from './pipeline-interpolation';
import type { PipelineVars } from './pipeline.types';

/**
 * Interpolation des pipelines de surface. Une variable mal résolue change le
 * comportement d'un bouton (mauvais Salon, mauvais gagnant) : contrat fixé ici.
 */

const GUILD = '1550000000000000001';
const CHANNEL = '1550000000000000002';
const ACTOR = '1550000000000000003';

function vars(overrides: Partial<PipelineVars> = {}): PipelineVars {
  return {
    guildId: GUILD,
    channelId: CHANNEL,
    actorId: ACTOR,
    actorName: 'Paul',
    surfaceId: 'surface-1',
    messageId: '1111111111111111111',
    state: { claimedBy: null, nested: { count: 2 } },
    steps: [{ value: 7 }],
    values: { member: '{"id":1}' },
    modalValues: { raison: 'un test' },
    event: { kind: 'join' },
    ...overrides,
  };
}

describe('PipelineInterpolator · interpolate', () => {
  const interpolator = new PipelineInterpolator();

  it('résout les identités du contexte', () => {
    expect(interpolator.interpolate('{{actor.id}} {{actor.username}} {{guild.id}} {{surface.channelId}} {{surface.messageId}}', vars())).toBe(
      `${ACTOR} Paul ${GUILD} ${CHANNEL} 1111111111111111111`,
    );
    expect(interpolator.interpolate('{{surface.messageId}}', vars({ messageId: null }))).toBe('');
  });

  it('résout state, steps, modal, value et event, chaîne vide si inconnu', () => {
    const v = vars();
    expect(interpolator.interpolate('{{state.nested.count}}|{{state.claimedBy}}|{{state.absent}}', v)).toBe('2||');
    expect(interpolator.interpolate('{{steps.0.value}}|{{steps.3.value}}', v)).toBe('7|');
    expect(interpolator.interpolate('{{modal.raison}}|{{value.member}}|{{event.kind}}|{{autre.chose}}', v)).toBe('un test|{"id":1}|join|');
  });

  it('tolère les espaces autour du chemin', () => {
    expect(interpolator.interpolate('Bonjour {{ actor.username }} !', vars())).toBe('Bonjour Paul !');
  });

  it('readPath lit un chemin pointé et rend undefined dès qu\u0027une étape manque', () => {
    expect(interpolator.readPath({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1);
    expect(interpolator.readPath({ a: { b: null } }, 'a.b.c')).toBeUndefined();
    expect(interpolator.readPath({}, 'x.y')).toBeUndefined();
  });

  it('coerce ramène les chaînes « vraies » et numériques à leur type', () => {
    expect(interpolator.coerce('true')).toBe(true);
    expect(interpolator.coerce('false')).toBe(false);
    expect(interpolator.coerce('12')).toBe(12);
    expect(interpolator.coerce('-3.5')).toBe(-3.5);
    expect(interpolator.coerce('abc')).toBe('abc');
    expect(interpolator.coerce(0)).toBe(0);
  });

  it('deepInterpolate traverse objets et tableaux, laisse les scalaires', () => {
    expect(
      interpolator.deepInterpolate({ qui: '{{actor.id}}', liste: ['{{guild.id}}', 2], nested: { canal: '{{ surface.channelId }}' }, garde: true }, vars()),
    ).toEqual({ qui: ACTOR, liste: [GUILD, 2], nested: { canal: CHANNEL }, garde: true });
  });
});

describe('PipelineInterpolator · setPath (setState)', () => {
  const interpolator = new PipelineInterpolator();

  it('set crée les intermédiaires et écrit null pour une valeur absente', () => {
    const state: Record<string, unknown> = {};
    interpolator.setPath(state, 'vote.a.oui', 3, 'set');
    interpolator.setPath(state, 'vide', undefined, 'set');
    expect(state).toEqual({ vote: { a: { oui: 3 } }, vide: null });
  });

  it('set remplace un scalaire qui gêne le chemin', () => {
    const state: Record<string, unknown> = { vote: 5 };
    interpolator.setPath(state, 'vote.nonce', 'x', 'set');
    expect(state).toEqual({ vote: { nonce: 'x' } });
  });

  it('increment, decrement et toggle partent de zéro ou de la valeur courante', () => {
    const state: Record<string, unknown> = {};
    interpolator.setPath(state, 'compteur', undefined, 'increment');
    interpolator.setPath(state, 'compteur', 4, 'increment');
    interpolator.setPath(state, 'compteur', 1, 'decrement');
    expect(state.compteur).toBe(4);
    interpolator.setPath(state, 'ferme', undefined, 'toggle');
    interpolator.setPath(state, 'ferme', undefined, 'toggle');
    expect(state.ferme).toBe(false);
  });
});

describe('PipelineInterpolator · resolveValue et display (setState référençant une étape)', () => {
  const interpolator = new PipelineInterpolator();
  const v = vars({ steps: [{ value: 7, text: '{"total":21}' }] });

  it('une référence UNIQUE garde le type de sa cible (le tirage reste un nombre)', () => {
    expect(interpolator.resolveValue('{{steps.0.value}}', v)).toBe(7);
    expect(interpolator.resolveValue('{{ state.nested.count }}', v)).toBe(2);
  });

  it('un texte mélangé est interpolé, une valeur non textuelle reste inchangée', () => {
    expect(interpolator.resolveValue('Total : {{steps.0.value}}', v)).toBe('Total : 7');
    expect(interpolator.resolveValue(5, v)).toBe(5);
    expect(interpolator.resolveValue(null, v)).toBeNull();
    expect(interpolator.resolveValue('sans référence', v)).toBe('sans référence');
  });

  it('display ne montre jamais [object Object]', () => {
    expect(interpolator.display(['A♠', '7♦'])).toBe('A♠, 7♦');
    expect(interpolator.display({ total: 21 })).toBe('{"total":21}');
    expect(interpolator.display([{ id: 1 }, 'x'])).toBe('[{"id":1},"x"]');
    expect(interpolator.display(undefined)).toBe('');
  });

  it('setState écrit le résultat typé d\u0027une étape dans l\u0027état', () => {
    const state: Record<string, unknown> = {};
    interpolator.setPath(state, 'game.card', interpolator.resolveValue('{{steps.0.value}}', v), 'set');
    expect(state).toEqual({ game: { card: 7 } });
  });
});
