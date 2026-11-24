import { describe, expect, it } from 'vitest';
import { hasMassMention, neutralizeMassMentions } from './mass-mentions';

/**
 * Mentions de masse : Discord les reconnaît sans tenir compte de la casse.
 * Une seule orthographe était neutralisée (`@everyone` exact), `@Everyone`
 * passait et pinguait tout le serveur.
 */

describe('neutralizeMassMentions', () => {
  it.each(['@everyone', '@Everyone', '@EVERYONE', '@here', '@Here', '@HERE'])('%s est neutralisé', (mention) => {
    expect(neutralizeMassMentions(`Alerte ${mention} !`)).toBe(`Alerte \`${mention.slice(1)}\` !`);
  });

  it('plusieurs mentions, mélangées, dans un même texte', () => {
    expect(neutralizeMassMentions('@everyone et @HERE, puis @here')).toBe('`everyone` et `HERE`, puis `here`');
  });

  it('la ponctuation qui suit ne protège pas la mention', () => {
    expect(neutralizeMassMentions('@everyone, @here!')).toBe('`everyone`, `here`!');
  });

  it('un mot qui commence pareil n\u0027est pas une mention ; un signe qui suit ne la protège pas', () => {
    expect(neutralizeMassMentions('@heretics @everyones @here2')).toBe('@heretics @everyones @here2');
    // Discord pourrait reconnaître la mention malgré le souligné : on ne prend pas le risque.
    expect(neutralizeMassMentions('rar @everyone_ @here-@everyone')).toBe('rar `everyone`_ `here`-`everyone`');
  });

  it('un texte sans mention de masse est rendu tel quel, mentions normales comprises', () => {
    const text = 'Salut <@1550000000000000001> et <@&1550000000000000002>, regarde #général';
    expect(neutralizeMassMentions(text)).toBe(text);
  });
});

describe('hasMassMention', () => {
  it('trouve une mention de masse quelle que soit sa casse, et ne se laisse pas piéger par deux appels de suite', () => {
    expect(hasMassMention('rien ici')).toBe(false);
    expect(hasMassMention('rien @Here')).toBe(true);
    expect(hasMassMention('rien @Here')).toBe(true);
  });
});
