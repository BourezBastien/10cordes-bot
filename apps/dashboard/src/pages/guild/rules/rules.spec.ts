import { describe, expect, it } from 'vitest';
import { buildPatch, countChanges } from '@/pages/guild/rules/api';
import { guildRules } from '@/test/fixtures';

/*
 * Règles : n'envoyer que ce qui change. Les listes de salons partent triées
 * (leur ordre ne signifie rien), les consignes par ajout et retrait.
 */

const OTHER = '1550835980116824102';

describe('buildPatch', () => {
  it('rend null sans changement', () => {
    expect(buildPatch(guildRules, guildRules, [], [])).toBeNull();
  });

  it('porte un interrupteur qui change, et rien d’autre', () => {
    expect(buildPatch(guildRules, { ...guildRules, seriousOnlyElsewhere: true }, [], [])).toEqual({ seriousOnlyElsewhere: true });
  });

  it('porte une liste de salons changée, triée, et l’ignore si seul l’ordre change', () => {
    expect(buildPatch(guildRules, { ...guildRules, freeChannelIds: [guildRules.freeChannelIds[0] ?? ''] }, [], [])).toBeNull();
    expect(buildPatch(guildRules, { ...guildRules, blockedChannelIds: [OTHER, '1550835980116824101'] }, [], [])).toEqual({
      blockedChannelIds: ['1550835980116824101', OTHER],
    });
  });

  it('envoie les consignes par ajout et retrait', () => {
    const patch = buildPatch(guildRules, guildRules, ['Tutoie les membres.'], ['Réponds en français.']);
    expect(patch).toEqual({ addCustomInstructions: ['Tutoie les membres.'], removeCustomInstructions: ['Réponds en français.'] });
  });
});

describe('countChanges', () => {
  it('compte les groupes qui diffèrent, les consignes pour un', () => {
    expect(countChanges(guildRules, guildRules, [], [])).toBe(0);
    expect(countChanges(guildRules, { ...guildRules, strictMentionElsewhere: false }, [], [])).toBe(1);
    expect(countChanges(guildRules, { ...guildRules, strictMentionElsewhere: false, blockedChannelIds: [OTHER] }, ['a'], ['b'])).toBe(3);
  });
});
