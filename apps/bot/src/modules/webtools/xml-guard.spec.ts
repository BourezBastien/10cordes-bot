import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { SAFE_XML_OPTIONS, assertSafeXml, decodeXmlText, xmlAt, xmlAttribute, xmlLink, xmlList, xmlText } from './xml-guard';

/**
 * Garde du XML venu du web. Les formes attendues ici ont été observées sur
 * l'analyseur installé (fast-xml-parser 5.12) et sur le flux RSS du Monde.
 */

const BILLION_LAUGHS = '<!DOCTYPE rss [<!ENTITY lol "lol">]><rss><channel><item><title>&lol;&lol;</title></item></channel></rss>';

describe('assertSafeXml', () => {
  it.each(['<!DOCTYPE rss [<!ENTITY lol "lol">]><rss/>', '<!doctype rss><rss/>', '<! DOCTYPE rss><rss/>', '<rss><!ENTITY x "y"/></rss>', '<!entity x "y"><rss/>'])(
    'refuse une déclaration de type de document ou une entité : %s',
    (xml) => {
      expect(() => assertSafeXml(xml)).toThrow('DOCTYPE ou des entités');
    },
  );

  it('un flux sans déclaration passe', () => {
    expect(() => assertSafeXml('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel/></rss>')).not.toThrow();
  });
});

describe('SAFE_XML_OPTIONS', () => {
  const title = (options: object): unknown => xmlAt(new XMLParser(options).parse(BILLION_LAUGHS), ['rss', 'channel', 'item', 'title']);

  it('par défaut, l\u0027analyseur lit le DOCTYPE et développe l\u0027entité déclarée', () => {
    expect(title({ ignoreAttributes: false })).toBe('lollol');
  });

  it('avec les options de garde, plus rien n\u0027est développé', () => {
    expect(title(SAFE_XML_OPTIONS)).toBe('&lol;&lol;');
  });

  it('un texte numérique ou booléen reste un texte', () => {
    const xml = '<rss><channel><item><title>007</title></item></channel></rss>';
    expect(xmlAt(new XMLParser({ ignoreAttributes: false }).parse(xml), ['rss', 'channel', 'item', 'title'])).toBe(7);
    expect(xmlAt(new XMLParser(SAFE_XML_OPTIONS).parse(xml), ['rss', 'channel', 'item', 'title'])).toBe('007');
  });

  it('une section CDATA est reconnue comme telle', () => {
    const parsed: unknown = new XMLParser(SAFE_XML_OPTIONS).parse('<rss><channel><t><![CDATA[<b> &amp;]]></t></channel></rss>');
    expect(xmlAt(parsed, ['rss', 'channel', 't'])).toEqual({ __cdata: '<b> &amp;' });
  });
});

describe('decodeXmlText', () => {
  it('les cinq entités prédéfinies et les références numériques sont décodées', () => {
    expect(decodeXmlText('Tom &amp; Jerry &#39;q&#39; &lt;b&gt; &quot;x&quot; &apos;y&apos;')).toBe('Tom & Jerry \u0027q\u0027 <b> "x" \u0027y\u0027');
    expect(decodeXmlText('&#x41;&#X42;&#x1F600;')).toBe(`AB${String.fromCodePoint(0x1f600)}`);
  });

  it('une entité non prédéfinie reste telle quelle : sans DOCTYPE, elle ne désigne rien', () => {
    expect(decodeXmlText('&lol; &nbsp;')).toBe('&lol; &nbsp;');
  });

  it('une référence invalide reste telle quelle', () => {
    for (const reference of ['&#0;', '&#xD800;', '&#x110000;', '&#xFFFE;', '&#99999999;', '&#ABC;']) {
      expect(decodeXmlText(reference)).toBe(reference);
    }
    expect(decodeXmlText('&#9;')).toBe('\t');
  });

  it('un seul passage : un texte doublement échappé n\u0027est pas décodé deux fois', () => {
    expect(decodeXmlText('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
  });
});

describe('xmlText', () => {
  it('un texte courant est décodé, une section CDATA est rendue telle quelle', () => {
    expect(xmlText('a &amp; b')).toBe('a & b');
    expect(xmlText({ '#text': 'a &amp; b' })).toBe('a & b');
    expect(xmlText({ __cdata: 'littéral &amp; et &#39;' })).toBe('littéral &amp; et &#39;');
    expect(xmlText({ '#text': 'avant', __cdata: ' <b> &amp; ' })).toBe('avant <b> &amp; ');
    expect(xmlText({ '@_href': 'https://x.test', __cdata: ['un', 'deux'] })).toBe('undeux');
  });

  it('sans texte : chaîne vide ; un nombre reste lisible', () => {
    for (const empty of [undefined, null, {}, [], { '@_href': 'https://x.test' }]) expect(xmlText(empty)).toBe('');
    expect(xmlText(1984)).toBe('1984');
  });
});

describe('xmlAttribute, xmlList, xmlLink', () => {
  it('un attribut est décodé, un attribut absent rend une chaîne vide', () => {
    expect(xmlAttribute({ '@_href': 'https://x.test/?a=1&amp;b=2' }, 'href')).toBe('https://x.test/?a=1&b=2');
    expect(xmlAttribute({ '@_rel': 'alternate' }, 'href')).toBe('');
    expect(xmlAttribute('https://x.test', 'href')).toBe('');
  });

  it('une liste d\u0027un, plusieurs ou aucun élément', () => {
    expect(xmlList(undefined)).toEqual([]);
    expect(xmlList(null)).toEqual([]);
    expect(xmlList('seul')).toEqual(['seul']);
    expect(xmlList(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('le lien d\u0027un article : texte du lien (RSS), sinon le lien alternatif, sinon le premier qui porte un href (Atom)', () => {
    expect(xmlLink({ link: 'https://x.test/a' })).toBe('https://x.test/a');
    expect(xmlLink({ link: [{ '@_rel': 'self', '@_href': 'https://x.test/feed' }, { '@_rel': 'alternate', '@_href': 'https://x.test/a?b=1&amp;c=2' }] })).toBe(
      'https://x.test/a?b=1&c=2',
    );
    expect(xmlLink({ link: [{ '@_rel': 'enclosure', '@_href': 'https://x.test/a.mp3' }] })).toBe('https://x.test/a.mp3');
    expect(xmlLink({ link: { '@_href': 'https://x.test/a?b=1&amp;c=2' } })).toBe('https://x.test/a?b=1&c=2');
    expect(xmlLink({ link: [{ '@_rel': 'enclosure' }] })).toBe('');
    expect(xmlLink({})).toBe('');
  });
});
