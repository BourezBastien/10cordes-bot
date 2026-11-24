/**
 * Mentions de masse (`@everyone`, `@here`). Discord les reconnaît sans tenir
 * compte de la casse : `@Everyone` pingue tout le serveur aussi. Neutralisée,
 * la mention s'affiche entre accents graves, sans rien pinguer.
 */

/** Une mention de masse : insensible à la casse, et non suivie d'une lettre ou d'un chiffre (`@here` oui, `@héro` non). */
const MASS_MENTION_SOURCE = '@(everyone|here)(?![\\p{L}\\p{N}])';
const MASS_MENTION_RE = new RegExp(MASS_MENTION_SOURCE, 'giu');
const MASS_MENTION_TEST_RE = new RegExp(MASS_MENTION_SOURCE, 'iu');

/** Le texte où chaque mention de masse est neutralisée : `@everyone` et `@Everyone` deviennent `` `everyone` `` et `` `Everyone` ``. */
export function neutralizeMassMentions(text: string): string {
  return text.replace(MASS_MENTION_RE, (match) => `\`${match.slice(1)}\``);
}

/** Le texte contient-il une mention de masse, quelle que soit sa casse ? */
export function hasMassMention(text: string): boolean {
  return MASS_MENTION_TEST_RE.test(text);
}
