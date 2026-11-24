/**
 * Garde du XML venu du web (flux RSS, Atom). Un flux n'a jamais besoin d'une
 * déclaration de type de document : c'est le vecteur des entités gonflées
 * (« billion laughs ») et, dans les analyseurs qui les résolvent, des entités
 * externes (fichier local, réseau interne). Toute déclaration est refusée
 * AVANT l'analyse, et l'analyseur reçoit `processEntities: false` : plus rien
 * n'est développé (par défaut, il lit les déclarations du DOCTYPE et
 * développe leurs entités). Les cinq entités prédéfinies du XML et les
 * références numériques, seules qu'un flux légitime utilise, sont décodées ici.
 */

/** Une déclaration de type de document ou une entité, où qu'elle soit dans le texte. */
const FORBIDDEN_DECLARATION_RE = /<!\s*(DOCTYPE|ENTITY)\b/iu;

/** Refuse un XML qui déclare un DOCTYPE ou une entité. */
export function assertSafeXml(xml: string): void {
  if (FORBIDDEN_DECLARATION_RE.test(xml)) throw new Error('Flux refusé : il déclare un DOCTYPE ou des entités, ce qu\u0027un flux RSS n\u0027a jamais besoin.');
}

/** Clé sous laquelle l'analyseur range le texte d'une section CDATA. */
const CDATA_KEY = '__cdata';

/**
 * Options de l'analyseur pour un flux venu du web : aucune entité développée,
 * aucun texte converti en nombre ou en booléen (un titre « 007 » reste un
 * texte), une section CDATA reconnue comme telle (rien n'y est échappé).
 */
export const SAFE_XML_OPTIONS = { ignoreAttributes: false, processEntities: false, parseTagValue: false, cdataPropName: CDATA_KEY } as const;

const PREDEFINED: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const ENTITY_RE = /&(lt|gt|amp|quot|apos|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/gu;

/** Point de code d'une référence numérique, ou null si elle est invalide (elle reste alors telle quelle). */
function codePointOf(reference: string): number | null {
  const hexadecimal = reference[1]?.toLowerCase() === 'x';
  const value = Number.parseInt(reference.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
  // Les caractères autorisés par XML : rien sous l'espace hors tabulation et fins de ligne, ni substitut, ni 0xFFFE et 0xFFFF.
  const allowed = value <= 0x10_ff_ff && (value >= 0x20 || value === 0x9 || value === 0xa || value === 0xd) && !(value >= 0xd8_00 && value <= 0xdf_ff) && value !== 0xff_fe && value !== 0xff_ff;
  return allowed ? value : null;
}

/**
 * Décode les entités prédéfinies du XML et les références numériques d'un
 * texte de flux. Toute autre référence reste telle quelle : sans DOCTYPE,
 * elle ne peut désigner aucune entité définie.
 */
export function decodeXmlText(text: string): string {
  return text.replace(ENTITY_RE, (whole: string, name: string | undefined) => {
    if (!name) return whole;
    if (name in PREDEFINED) return PREDEFINED[name] ?? whole;
    const code = codePointOf(name);
    return code === null ? whole : String.fromCodePoint(code);
  });
}

/** Chaînes d'une valeur : la valeur elle-même, chaque membre si c'est un tableau. */
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((part): part is string => typeof part === 'string') : [];
}

/**
 * Texte d'un élément d'un flux. Le texte courant est décodé ; le texte d'une
 * section CDATA est rendu tel quel, rien n'y est échappé. Un élément sans
 * texte rend une chaîne vide.
 */
export function xmlText(node: unknown): string {
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (typeof node === 'string') return decodeXmlText(node);
  if (node === null || typeof node !== 'object') return '';
  const value = node as Record<string, unknown>;
  const text = stringsOf(value['#text']).map(decodeXmlText).join('');
  return text + stringsOf(value[CDATA_KEY]).join('');
}

/** Attribut d'un élément (`href` d'un lien Atom), décodé ; chaîne vide s'il est absent. */
export function xmlAttribute(node: unknown, name: string): string {
  if (node === null || typeof node !== 'object') return '';
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return typeof value === 'string' ? decodeXmlText(value) : '';
}

/** Valeur d'un chemin dans un document analysé, undefined dès qu'un maillon manque. */
export function xmlAt(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((node, key) => (node !== null && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>)[key] : undefined), source);
}

/** Éléments d'une liste de flux, qu'il en porte un, plusieurs ou aucun. */
export function xmlList(node: unknown): unknown[] {
  if (Array.isArray(node)) return node;
  return node === undefined || node === null ? [] : [node];
}

/** Lien d'un article : texte du lien (RSS), sinon le lien alternatif, sinon le premier qui porte un `href` (Atom). */
export function xmlLink(item: unknown): string {
  const links = xmlList(xmlAt(item, ['link'])).map((link) => ({ url: xmlText(link) || xmlAttribute(link, 'href'), rel: xmlAttribute(link, 'rel') }));
  const usable = links.filter((link) => link.url !== '');
  return (usable.find((link) => !link.rel || link.rel === 'alternate') ?? usable[0])?.url ?? '';
}
