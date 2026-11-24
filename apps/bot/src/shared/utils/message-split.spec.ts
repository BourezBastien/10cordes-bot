import { describe, expect, it } from 'vitest';
import { DISCORD_MESSAGE_MAX, splitDiscordMessage } from './message-split';

/**
 * Découpage d'un texte pour Discord. Ce que fixent ces tests : chaque
 * morceau tient dans un message, rien ne se perd, et la coupure ne se voit
 * pas : jamais dans un emoji, une mention, un lien, un code en ligne, ni au
 * milieu d'un bloc de code quand il peut tenir entier.
 */

const codeBlock = (lines: string[], lang = 'js'): string => `\`\`\`${lang}\n${lines.join('\n')}\n\`\`\``;
/** Lignes de balise d'un morceau : un morceau bien formé en porte un nombre pair. */
const fenceLines = (chunk: string): number => (chunk.match(/^ {0,3}`{3,}/gmu) ?? []).length;

describe('splitDiscordMessage · ce qui tient en un message', () => {
  it('un texte court est renvoyé tel quel, et le vide rend un morceau vide', () => {
    expect(splitDiscordMessage('Bonjour **toi**')).toEqual(['Bonjour **toi**']);
    expect(splitDiscordMessage('')).toEqual(['']);
  });

  it('exactement la limite tient en un message, un de plus en deux', () => {
    expect(splitDiscordMessage('a'.repeat(DISCORD_MESSAGE_MAX))).toEqual(['a'.repeat(DISCORD_MESSAGE_MAX)]);
    expect(splitDiscordMessage('a'.repeat(DISCORD_MESSAGE_MAX + 1))).toEqual(['a'.repeat(DISCORD_MESSAGE_MAX), 'a']);
  });

  it('les fins de ligne Windows et MacOS sont normalisées', () => {
    expect(splitDiscordMessage('a\r\nb\rc')).toEqual(['a\nb\nc']);
  });

  it.each([8, 11, 2000.5, Number.NaN])('une limite de %s est refusée : plus la place de refermer un bloc de code', (limit) => {
    expect(() => splitDiscordMessage('x', limit)).toThrow(RangeError);
  });
});

describe('splitDiscordMessage · où ça coupe', () => {
  it('1. entre deux paragraphes', () => {
    expect(splitDiscordMessage('aaa bbb ccc\nddd eee\n\nfff ggg\nhhh', 30)).toEqual(['aaa bbb ccc\nddd eee\n\n', 'fff ggg\nhhh']);
  });

  it('2. entre deux lignes, sans paragraphe', () => {
    expect(splitDiscordMessage('aaaa bbbb\ncccc dddd eeee', 14)).toEqual(['aaaa bbbb\n', 'cccc dddd eeee']);
  });

  it('3. entre deux mots, sans ligne', () => {
    expect(splitDiscordMessage('aaaa bbbb cccc dddd', 14)).toEqual(['aaaa bbbb ', 'cccc dddd']);
  });

  it('une coupure propre trop tôt ne vaut pas un morceau minuscule : on lui préfère une plus loin', () => {
    // La fin de ligne est à 5 unités d\u0027un morceau de 14 : l\u0027espace à 10 est pris à sa place.
    expect(splitDiscordMessage('aaaa\nbbbb cccc dddd', 14)).toEqual(['aaaa\nbbbb ', 'cccc dddd']);
    // Sans aucun espace après, la fin de ligne trop tôt cède la place à la coupure pleine.
    expect(splitDiscordMessage('aaaa\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 14)).toEqual(['aaaa\nbbbbbbbbb', 'bbbbbbbbbbbbbb', 'bbbbbbbbbbbbbb', 'bbb']);
  });

  it('4. sans rien de propre, à une frontière de graphème au plus près de la limite', () => {
    expect(splitDiscordMessage('aaaaaaaaaabbbbbbbbbbcccccccccc', 14)).toEqual(['aaaaaaaaaabbbb', 'bbbbbbcccccccc', 'cc']);
  });

  it('un long texte est partagé en morceaux pleins, sans rien perdre', () => {
    const text = 'x'.repeat(4500);
    const chunks = splitDiscordMessage(text);
    expect(chunks.map((chunk) => chunk.length)).toEqual([2000, 2000, 500]);
    expect(chunks.join('')).toBe(text);
  });
});

describe('splitDiscordMessage · jamais au milieu de', () => {
  it('un emoji : famille ZWJ et peau, chaque morceau reste entier', () => {
    const family = '👩‍👧‍👦';
    expect(splitDiscordMessage(family.repeat(3), 12)).toEqual([family, family, family]);

    const thumb = '👍🏽';
    const chunks = splitDiscordMessage(thumb.repeat(5), 15);
    expect(chunks).toEqual([thumb.repeat(3), thumb.repeat(2)]);
  });

  it('une mention de membre : elle part entière dans son morceau', () => {
    expect(splitDiscordMessage('aaaa <@1550000000000000001> bbbb', 30)).toEqual(['aaaa <@1550000000000000001> ', 'bbbb']);
    expect(splitDiscordMessage('aaaa <@&1550000000000000002> <#:emoji:1550000000000000003>', 30)).toEqual(['aaaa <@&1550000000000000002> ', '<#:emoji:1550000000000000003>']);
  });

  it('un lien nu : le mot d\u0027avant est coupé plutôt que le lien, même tôt', () => {
    expect(splitDiscordMessage('voir https://example.test/x?aaaa=1 et suite', 30)).toEqual(['voir ', 'https://example.test/x?aaaa=1 ', 'et suite']);
  });

  it('un lien Markdown, un code en ligne', () => {
    expect(splitDiscordMessage('[doc](https://example.test/x) et suite', 30)).toEqual(['[doc](https://example.test/x) ', 'et suite']);
    expect(splitDiscordMessage('x `code très long` yyy', 20)).toEqual(['x `code très long` ', 'yyy']);
  });

  it('un lien plus long qu\u0027un message est coupé au plus près, chaque morceau tenant dans un message', () => {
    const url = `https://example.test/${'a'.repeat(2100)}`;
    const chunks = splitDiscordMessage(url);
    expect(chunks.map((chunk) => chunk.length)).toEqual([2000, 121]);
    expect(chunks.join('')).toBe(url);
  });
});

describe('splitDiscordMessage · blocs de code', () => {
  it('un bloc qui tient est coupé après sa fin, entier', () => {
    const text = 'intro\n```js\nconst a = 1;\n```\nbbb bbb bbb';
    expect(splitDiscordMessage(text, 30)).toEqual(['intro\n```js\nconst a = 1;\n```\n', 'bbb bbb bbb']);
  });

  it('un bloc court suivi d\u0027un paragraphe : la coupure tombe sur le paragraphe', () => {
    expect(splitDiscordMessage('aaa\n\n```js\ncode\n```\n\nbbb', 23)).toEqual(['aaa\n\n```js\ncode\n```\n\n', 'bbb']);
  });

  it('un bloc plus long qu\u0027un message est coupé entre ses lignes, refermé puis rouvert à chaque morceau', () => {
    const text = '```js\n' + `${'A'.repeat(100)}\n${'B'.repeat(100)}\n` + '```\nfin';
    const chunks = splitDiscordMessage(text, 60);
    expect(chunks).toEqual([
      '```js\n' + `${'A'.repeat(50)}\n\`\`\``,
      '```js\n' + `${'A'.repeat(50)}\n\`\`\``,
      // Une fin de ligne juste après le début (un saut de ligne seul) est ignorée : le morceau se remplit.
      '```js\n' + `\n${'B'.repeat(49)}\n\`\`\``,
      // La balise fermante du texte n'est jamais coupée : le morceau s'arrête à la ligne d'avant.
      '```js\n' + `${'B'.repeat(50)}\n\`\`\``,
      '```js\nB\n```\nfin',
    ]);
    for (const chunk of chunks) expect(fenceLines(chunk) % 2).toBe(0);
  });

  it('un bloc qui tient en un message est laissé entier', () => {
    const block = codeBlock(['const a = 1;', 'const b = 2;', '', 'console.log(a + b);']);
    const text = `${block}\n\nEt voici le résultat, en une phrase.`;
    expect(splitDiscordMessage(text)).toEqual([text]);
  });

  it('un long bloc : chaque morceau tient dans un message, ses balises sont équilibrées, rien ne se perd', () => {
    const lines = Array.from({ length: 60 }, (_, index) => `ligne ${index}: ${'x'.repeat(index % 7 === 0 ? 900 : 40)}`);
    const block = codeBlock(lines, 'ts');
    const text = 'Voici le code :\n\n' + block + '\n\nFin.';
    const chunks = splitDiscordMessage(text);

    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks[0]?.startsWith('Voici le code :')).toBe(true);
    expect(chunks.at(-1)?.endsWith('Fin.')).toBe(true);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(DISCORD_MESSAGE_MAX);
      expect(fenceLines(chunk) % 2).toBe(0);
    }
    // Les morceaux du milieu reprennent le bloc là où il a été coupé.
    for (const chunk of chunks.slice(1, -1)) expect(chunk.startsWith('```ts\n')).toBe(true);
    // En retirant la balise rouverte en tête et celle qui referme en fin, chaque morceau est un
    // tronçon du texte d'origine, dans l'ordre (la fin de ligne ajoutée avant une fermeture est tolérée).
    let cursor = 0;
    chunks.forEach((chunk, index) => {
      let body = index > 0 && chunk.startsWith('```ts\n') ? chunk.slice('```ts\n'.length) : chunk;
      if (index < chunks.length - 1 && body.endsWith('```')) body = body.slice(0, -3);
      if (text.startsWith(body, cursor)) cursor += body.length;
      else {
        expect(body.endsWith('\n')).toBe(true);
        expect(text.startsWith(body.slice(0, -1), cursor)).toBe(true);
        cursor += body.length - 1;
      }
    });
    expect(cursor).toBe(text.length);
  });
});
