import { describe, expect, it } from 'vitest';
import { REGISTERED_TOOL_NAMES, TOOL_EFFECTS, isMutatingTool, toolEffectOf } from '../src/index.js';

/**
 * Classification des outils : chaque nom du registry est classé une fois, ni
 * plus ni moins. La porte d'approbation et l'intention d'une demande lisent
 * toutes deux cette table : un outil oublié serait, pour l'une, mis en
 * attente sans raison et, pour l'autre, pris pour une action.
 */
describe('TOOL_EFFECTS', () => {
  it('chaque outil du registry est classé, et lui seul', () => {
    expect(Object.keys(TOOL_EFFECTS).sort()).toEqual([...REGISTERED_TOOL_NAMES].sort());
  });

  it('les trois effets sont employés', () => {
    expect([...new Set(Object.values(TOOL_EFFECTS))].sort()).toEqual(['direct', 'read', 'write']);
  });

  it('tout outil signalé destructif est une écriture', () => {
    const destructive = [
      'banMember',
      'channel.remove',
      'deleteChannel',
      'deleteMessage',
      'deleteRole',
      'disableModule',
      'kickMember',
      'lockdown',
      'memory.forget',
      'muteMember',
      'provider.upsert',
      'purgeMessages',
      'records.delete',
      'temp.sanction',
    ];
    for (const name of destructive) expect(TOOL_EFFECTS[name as keyof typeof TOOL_EFFECTS]).toBe('write');
  });

  it('l\u0027outillage de la conversation et les livrables ne sont jamais mis en attente', () => {
    for (const name of ['search_tools', 'search_skills', 'openSkill', 'skipReply', 'translate', 'generateImage', 'generateMusic', 'generatePdf', 'config.panel', 'providers.panel']) {
      expect(TOOL_EFFECTS[name as keyof typeof TOOL_EFFECTS]).toBe('direct');
    }
  });
});

describe('toolEffectOf et isMutatingTool', () => {
  it('un nom inconnu compte pour une écriture : la porte se ferme, elle ne s\u0027ouvre pas', () => {
    expect(toolEffectOf('tool.jamais.classe')).toBe('write');
    expect(isMutatingTool('tool.jamais.classe')).toBe(true);
  });

  it('seule une écriture modifie', () => {
    expect(isMutatingTool('renameChannel')).toBe(true);
    expect(isMutatingTool('getChannels')).toBe(false);
    expect(isMutatingTool('search_tools')).toBe(false);
    expect(toolEffectOf('sendMessage')).toBe('write');
  });
});
