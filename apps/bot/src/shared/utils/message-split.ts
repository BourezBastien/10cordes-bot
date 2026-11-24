/**
 * Découpage d'un texte pour Discord. Un message tient en 2000 unités
 * (UTF-16, la longueur d'une chaîne JavaScript : la mesure la plus prudente).
 * Au-delà, le texte est coupé là où ça ne se voit pas :
 *
 *   1. entre deux paragraphes, 2. entre deux lignes, 3. entre deux mots,
 *   4. sinon n'importe où, à une frontière de graphème ;
 *
 * et JAMAIS au milieu d'un emoji, d'une mention (membre, rôle, salon,
 * emoji personnalisé), d'un lien, ou d'un code en ligne. Un bloc de code est
 * coupé hors de lui ; quand il dépasse à lui seul un message, il est coupé
 * entre deux lignes et ses balises sont refermées puis rouvertes, pour que
 * chaque morceau s'affiche correctement. Un texte sans aucune coupure
 * possible (un lien plus long qu'un message) est coupé au plus près.
 */

/** Limite d'un message Discord, en unités UTF-16. */
export const DISCORD_MESSAGE_MAX = 2000;

/**
 * Sous cette limite, il n'y a plus la place de rouvrir et de refermer un
 * bloc de code coupé : erreur de l'appelant.
 */
const LIMIT_MIN = 12;
/** Fermeture d'un bloc de code en fin de morceau : une fin de ligne et trois accents graves. */
const CLOSING_FENCE = '\n```';
/**
 * Une coupure « propre » (paragraphe, ligne, espace) n'est préférée que si
 * elle remplit au moins cette part du morceau : sinon elle ferait un
 * morceau minuscule suivi d'un autre.
 */
const MIN_FILL = 0.5;

/**
 * Ce qu'une coupure ne traverse jamais : mention ou emoji personnalisé
 * (`<@id>`, `<@&id>`, `<#id>`, `<:nom:id>`), lien Markdown puis lien nu,
 * code en ligne.
 */
const PROTECTED_RE = /<[^\s<>]{1,100}>|\[[^\]\n]{1,200}\]\(\s*https?:\/\/[^)\s]{1,500}\s*\)|(?:https?:\/\/|www\.)[^\s<>)\]]{1,500}|`[^`\n]{1,1900}`/giu;

/** Ligne ouvrant ou fermant un bloc de code (jusqu'à trois espaces en tête, comme en Markdown). */
const FENCE_RE = /^ {0,3}`{3,}[^\n]*$/gmu;

/** Priorité d'une coupure : plus grand = préférable. */
const CUT = { paragraph: 4, line: 3, space: 2, anywhere: 1 } as const;

interface Range {
  readonly start: number;
  readonly end: number;
}

interface FenceLine {
  readonly start: number;
  /** Fin de la ligne, accents graves compris : là où le code du bloc commence. */
  readonly end: number;
  /** La ligne d'ouverture telle quelle (` ```js `), pour rouvrir le bloc au morceau suivant. */
  readonly text: string;
}

/** Une coupure possible. */
interface Candidate {
  readonly at: number;
  /** Hors d'un bloc de code. */
  readonly outside: boolean;
  /** Assez tardive pour valoir un morceau. */
  readonly usable: boolean;
  readonly priority: number;
}

const graphemes = new Intl.Segmenter('fr', { granularity: 'grapheme' });

function rangesOf(text: string): Range[] {
  return [...text.matchAll(PROTECTED_RE)].map((match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }));
}

function fencesOf(text: string): FenceLine[] {
  return [...text.matchAll(FENCE_RE)].map((match) => {
    const end = text.indexOf('\n', match.index ?? 0);
    return { start: match.index ?? 0, end: end === -1 ? text.length : end, text: (match[0] ?? '').trimEnd() };
  });
}

/** Frontières de graphèmes du texte, triées, avec le début et la fin. */
function boundariesOf(text: string): number[] {
  const found = new Set<number>([0, text.length]);
  for (const { index } of graphemes.segment(text)) found.add(index);
  return [...found].sort((a, b) => a - b);
}

/** La plus grande frontière de graphème inférieure ou égale à `position`. */
function boundaryAtOrBefore(boundaries: readonly number[], position: number): number {
  let low = 0;
  let high = boundaries.length - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const value = boundaries[middle] ?? 0;
    if (value <= position) {
      found = value;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

const insideProtected = (ranges: readonly Range[], at: number): boolean => ranges.some((range) => range.start < at && at < range.end);

/** Balises de bloc de code ouvertes avant `at` : la dernière, celle du bloc qui contient `at` (null hors d'un bloc). */
function blockOpenedBefore(fences: readonly FenceLine[], at: number): FenceLine | null {
  let opened: FenceLine | null = null;
  for (const fence of fences) {
    if (fence.start >= at) break;
    // Chaque balise bascule l'état du bloc : ouverte, puis fermée.
    opened = opened ? null : fence;
  }
  return opened;
}

/** Priorité d'une coupure hors d'un bloc, pour le morceau qui commence en `start`. */
function priorityAt(text: string, start: number, at: number): number {
  if (at <= start || text[at] === '\n') return 0;
  if (text[at - 1] === '\n') return text[at - 2] === '\n' ? CUT.paragraph : CUT.line;
  if (text[at - 1] === ' ' && text[at] !== ' ') return CUT.space;
  return CUT.anywhere;
}

/** Une coupure à l'intérieur d'une ligne de balise (entre ses accents graves, ou juste avant sa fin de ligne) : elle y couperait la balise. */
const insideFenceLine = (fences: readonly FenceLine[], at: number): boolean => fences.some((fence) => fence.start < at && at <= fence.end);

/** Meilleure coupure : assez tardive d'abord (un morceau minuscule n'aide personne), puis hors d'un bloc, puis la meilleure priorité, puis la plus tardive. */
function ranksAbove(candidate: Candidate, best: Candidate | null): boolean {
  if (!best) return true;
  if (candidate.usable !== best.usable) return candidate.usable;
  if (candidate.outside !== best.outside) return candidate.outside;
  if (candidate.priority !== best.priority) return candidate.priority > best.priority;
  return candidate.at > best.at;
}

/**
 * La coupure entre `start` et `maxEnd` (frontière de graphème la plus tardive
 * permise). Jamais dans un emoji, une mention, un lien, un code en ligne,
 * ni dans une ligne de balise. Une coupure propre vaut toujours mieux
 * qu'une coupure au plus près de la limite ; dans un bloc, seules comptent
 * les fins de ligne assez tardives : une ligne de code seul dans un message
 * n'aide personne. Sans aucune coupure retenue : au plus près de la limite,
 * hors d'une ligne de balise.
 */
function chooseCut(text: string, start: number, maxEnd: number, fill: number, boundaries: readonly number[], ranges: readonly Range[], fences: readonly FenceLine[]): number {
  let best: Candidate | null = null;
  for (const at of boundaries) {
    if (at <= start) continue;
    if (at > maxEnd) break;
    if (insideProtected(ranges, at) || insideFenceLine(fences, at)) continue;
    const opened = blockOpenedBefore(fences, at);
    const priority = opened ? (text[at - 1] === '\n' ? CUT.line : 0) : priorityAt(text, start, at);
    if (priority === 0) continue;
    const candidate: Candidate = { at, outside: opened === null, usable: at >= fill, priority };
    if (opened && !candidate.usable) continue;
    if (ranksAbove(candidate, best)) best = candidate;
  }
  if (best) return best.at;
  const nearest = boundaryAtOrBefore(boundaries, maxEnd);
  // Le plus près de la limite, mais jamais au milieu d'une ligne de balise : juste avant elle alors.
  const fence = fences.find((line) => line.start < nearest && nearest <= line.end);
  return Math.max(fence?.start ?? nearest, start + 1);
}

/**
 * Coupe un texte en morceaux qui tiennent chacun dans un message Discord.
 * Un texte qui tient en un message est renvoyé tel quel, fins de ligne
 * normalisées. Le vide rend un morceau vide.
 */
export function splitDiscordMessage(text: string, limit = DISCORD_MESSAGE_MAX): string[] {
  if (!Number.isInteger(limit) || limit < LIMIT_MIN) throw new RangeError(`La limite d\u0027un message doit être un entier d\u0027au moins ${LIMIT_MIN} (reçu : ${limit}).`);
  const source = text.replace(/\r\n?/gu, '\n');
  if (source.length <= limit) return [source];

  const boundaries = boundariesOf(source);
  const ranges = rangesOf(source);
  const fences = fencesOf(source);
  const chunks: string[] = [];
  let start = 0;
  /** Ce que le morceau à venir porte en tête : l'ouverture du bloc de code coupé juste avant. */
  let carry = '';
  while (start < source.length) {
    const room = limit - carry.length;
    if (source.length - start <= room) {
      chunks.push(carry + source.slice(start));
      break;
    }
    const cut = (maxEnd: number): number => chooseCut(source, start, maxEnd, start + Math.floor(room * MIN_FILL), boundaries, ranges, fences);
    let at = cut(start + room);
    let opened = blockOpenedBefore(fences, at);
    // La coupure tombe dans un bloc de code et il faut le refermer : la place est prise sur ce morceau.
    if (opened && at - start + CLOSING_FENCE.length > room) {
      at = cut(start + room - CLOSING_FENCE.length);
      opened = blockOpenedBefore(fences, at);
    }
    const body = carry + source.slice(start, at);
    if (!opened) {
      chunks.push(body);
      carry = '';
    } else {
      chunks.push(body.endsWith('\n') ? `${body}\`\`\`` : `${body}${CLOSING_FENCE}`);
      carry = `${opened.text}\n`;
    }
    start = at;
  }
  return chunks;
}
