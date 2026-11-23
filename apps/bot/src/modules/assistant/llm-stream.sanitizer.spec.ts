import { describe, expect, it } from 'vitest';
import { containsInternalTokens, LlmStreamSanitizer, stripSpecialTokens } from './llm-stream.sanitizer';

/**
 * Dernière barrière avant Discord : les jetons internes d'appel d'outil du
 * modèle (`<｜DSML｜function_calls>`...) ne doivent JAMAIS paraître en salon.
 * Ils arrivent en morceaux : la queue suspecte est retenue jusqu'à levée du doute.
 */

/** Le jeton d'ouverture de DeepSeek : `<` puis la barre verticale pleine largeur (U+FF5C). */
const DSML_OPEN = `<${String.fromCharCode(0xff5c)}DSML${String.fromCharCode(0xff5c)}function_calls>`;

describe('LlmStreamSanitizer · fuites de jetons internes', () => {
  it('signale une ouverture DSML coupée en plein milieu par deux deltas', () => {
    const sanitizer = new LlmStreamSanitizer();
    expect(sanitizer.push('Voici le résultat : ')).toBe('Voici le résultat : ');
    expect(sanitizer.push('<')).toBe('');
    expect(sanitizer.didLeak).toBe(false);
    expect(sanitizer.push(DSML_OPEN.slice(1))).toBe('');
    expect(sanitizer.didLeak).toBe(true);
    expect(sanitizer.push('la suite')).toBe('');
    expect(sanitizer.finish()).toBe('');
  });

  it.each([`<${String.fromCharCode(0xff5c)}tool${String.fromCharCode(0x2581)}calls${String.fromCharCode(0x2581)}begin${String.fromCharCode(0xff5c)}>`, '<|tool_call|>', '<tool_call>', 'texte puis </tool_call>', '<invoke name="records.create">'])('signale le jeton « %s »', (token) => {
    const sanitizer = new LlmStreamSanitizer();
    sanitizer.push(token);
    expect(sanitizer.didLeak).toBe(true);
  });

  it('signale une balise XML d\u0027appel d\u0027outil à l\u0027ouverture du texte', () => {
    const sanitizer = new LlmStreamSanitizer();
    sanitizer.push('\n  <parameter name="path">');
    expect(sanitizer.didLeak).toBe(true);
  });

  it('laisse passer mentions, salons, emoji et balise de gras', () => {
    const sanitizer = new LlmStreamSanitizer();
    // `<@` ne peut pas ouvrir une balise interne : rien n'est retenu.
    expect(sanitizer.push('<@')).toBe('<@');
    expect(sanitizer.push('1550000000000000001> regarde <#1550000000000000002> : **voilà** 😀')).toBe(
      '1550000000000000001> regarde <#1550000000000000002> : **voilà** 😀',
    );
    expect(sanitizer.push(' <b>gras</')).toBe(' <b>gras');
    expect(sanitizer.push('b>')).toBe('</b>');
    expect(sanitizer.didLeak).toBe(false);
  });

  it('un `<parameter>` cité au milieu d\u0027un texte n\u0027est pas une fuite', () => {
    const sanitizer = new LlmStreamSanitizer();
    sanitizer.push('En XML, la balise ');
    sanitizer.push('<parameter name="x">');
    expect(sanitizer.didLeak).toBe(false);
  });

  it('relâche à la fin du flux une queue jamais fermée', () => {
    const sanitizer = new LlmStreamSanitizer();
    expect(sanitizer.push('2 < 3 puis ')).toBe('2 < 3 puis ');
    expect(sanitizer.push('a <')).toBe('a ');
    expect(sanitizer.finish()).toBe('<');
    expect(sanitizer.didLeak).toBe(false);
  });

  it('retient un début de balise tant qu\u0027il peut en être une, puis le relâche', () => {
    const sanitizer = new LlmStreamSanitizer();
    expect(sanitizer.push('<tool')).toBe('');
    expect(sanitizer.push('tip')).toBe('');
    expect(sanitizer.push('> voilà')).toBe('<tooltip> voilà');
    expect(sanitizer.didLeak).toBe(false);
  });

  it('une balise d\u0027appel d\u0027outil arrivant caractère par caractère est bien signalée', () => {
    const sanitizer = new LlmStreamSanitizer();
    expect(sanitizer.push('Je lance ')).toBe('Je lance ');
    expect(sanitizer.push('<')).toBe('');
    expect(sanitizer.push('/')).toBe('');
    expect(sanitizer.push('tool_call>')).toBe('');
    expect(sanitizer.didLeak).toBe(true);
  });
});

describe('containsInternalTokens et stripSpecialTokens · appel bloquant', () => {
  it('détecte un jeton interne, même loin dans le texte', () => {
    expect(containsInternalTokens(`réponse ${DSML_OPEN}`)).toBe(true);
    expect(containsInternalTokens('<tool_call>{"name":"x"}</tool_call>')).toBe(true);
    expect(containsInternalTokens('réponse <@1550000000000000001> propre')).toBe(false);
    expect(containsInternalTokens('la balise <parameter name="x"> sert à')).toBe(false);
  });

  it('retire les jetons spéciaux et garde le texte utile', () => {
    const bar = String.fromCharCode(0xff5c);
    expect(stripSpecialTokens(`Voilà. ${DSML_OPEN} <${bar}DSML${bar}invoke name="x"> et <|tool_call|>`)).toBe('Voilà. et');
  });
});
