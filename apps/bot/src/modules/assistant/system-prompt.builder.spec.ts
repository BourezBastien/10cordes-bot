import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './system-prompt.builder';

/**
 * Prompt système : une partie STATIQUE (préfixe de cache identique d'une
 * demande à l'autre) et une partie dynamique (serveur, permissions, tools,
 * mémoire). La statique porte les règles qui ne dépendent d'aucun serveur.
 */

const EMPTY = { guildMemories: [], memberMemories: [] };

const build = (toolGuidance: string[] = []) => buildSystemPrompt('fr', 'Un serveur', 'general', [], [], EMPTY, [], [], [], toolGuidance);

describe('buildSystemPrompt', () => {
  it('la partie statique est un préfixe identique d\u0027une demande à l\u0027autre (cache de préfixe)', () => {
    const first = buildSystemPrompt('fr', 'Un serveur', 'general', [], ['Administrator'], EMPTY, ['action'], ['skill'], ['règle']);
    const second = buildSystemPrompt('fr', 'Un autre', 'blabla', ['toolA'], [], { guildMemories: ['fiche'], memberMemories: [] }, [], [], [], ['consigne']);
    // La statique s\u0027arrête à sa dernière balise : ensuite viennent les règles du serveur puis le contexte.
    const end = '</AUDIT_AND_REPORTING>';
    expect(first).toContain(end);
    expect(first.slice(0, first.indexOf(end))).toBe(second.slice(0, second.indexOf(end)));
    expect(first).toContain('Réponds toujours dans la langue : fr.');
    // La dynamique, elle, suit la demande.
    expect(first).toContain('<SERVER_RULES>');
    expect(second).not.toContain('<SERVER_RULES>');
    expect(second).toContain('Serveur : Un autre.');
  });

  it('règle des moteurs d\u0027image : elle désigne les outils par moteur et interdit d\u0027inventer', () => {
    const prompt = build();
    const rule = prompt.split('\n').find((line) => line.startsWith('MOTEURS D\u0027IMAGE')) ?? '';
    expect(rule).toContain('PixelLab (image.icon, image.emoji)');
    expect(rule).toContain('Tout autre rendu : generateImage');
    expect(rule).toContain("Aucun moteur : refuse honnêtement, n'invente pas d'image");
    expect(rule).toContain('avant de consommer des crédits');
  });

  it('la ligne des moteurs de CE serveur arrive dans les consignes, en dernier', () => {
    const engines = 'MOTEURS D\u0027IMAGE de ce serveur : PixelLab ACTIF ; image.generate → kie-ai / z-image.';
    const prompt = build(['Consigne d\u0027une primitive.', engines]);
    const lines = prompt.split('\n');
    expect(lines).toContain('- Consigne d\u0027une primitive.');
    expect(lines.indexOf(`- ${engines}`)).toBeGreaterThan(lines.indexOf('- Consigne d\u0027une primitive.'));
    expect(lines.indexOf(`- ${engines}`)).toBeLessThan(lines.indexOf('</TOOLSET>'));
  });

  it('sans consigne, le bloc des primitives n\u0027est pas affiché', () => {
    expect(build()).not.toContain('CONSIGNES DES PRIMITIVES');
    expect(build(['Une consigne.'])).toContain('CONSIGNES DES PRIMITIVES');
  });
});
