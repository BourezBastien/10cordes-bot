/*
 * RAPPROCHEMENT D'UN FAIT AVEC UN TEXTE. Une correction dit quel fait est
 * périmé ; pour retirer ce fait des entrées du journal, et l'empêcher de
 * revenir dans la fiche, il faut en reconnaître les reformulations.
 *
 * On compare les mots significatifs : sans casse ni accents, hors mots de
 * liaison, ramenés à leurs premières lettres (un verbe conjugué se reconnaît
 * à son radical). Un texte PORTE un fait quand il en contient la majeure
 * partie. Un fait trop court pour être reconnu sûrement n'entraîne rien :
 * la correction reste injectée telle quelle, mais rien n'est retiré à son nom.
 *
 * Fonctions pures : ni base, ni modèle.
 */

/** Part des mots d'un fait qui doit se retrouver dans un texte pour qu'il le porte. */
export const CARRIES_RATIO = 0.7;
/** En dessous, un fait est trop court pour être reconnu sans risque. */
const MIN_TOKENS = 2;
/** Longueur du radical comparé : « habite », « habitais » et « habiter » se rejoignent. */
const STEM_LENGTH = 5;

/** Bornes d'un fait : assez pour être reconnu, assez peu pour rester une phrase. */
export const FACT_MIN = 3;
export const FACT_MAX = { old: 300, new: 500 } as const;
/** Corrections actives gardées par fiche (le serveur, ou un membre) : au-delà, les plus anciennes cèdent la place. */
export const CORRECTIONS_MAX = 20;

/** Mots de liaison, pronoms et auxiliaires, français et anglais : ils ne distinguent rien. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  // Français.
  'les', 'des', 'ses', 'ces', 'mes', 'tes', 'nos', 'vos', 'une', 'aux', 'sur', 'dans', 'avec', 'pour', 'par', 'que', 'qui', 'quoi', 'dont',
  'est', 'sont', 'son', 'mon', 'pas', 'non', 'oui', 'ici', 'car', 'donc', 'alors', 'tout', 'tous', 'toute', 'toutes', 'plus', 'moins', 'aussi', 'comme', 'mais',
  'elle', 'elles', 'nous', 'vous', 'ils', 'eux',
  // Anglais.
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'has', 'have', 'had', 'not', 'but', 'his', 'her', 'its', 'their', 'was', 'were', 'will', 'would',
  'about', 'into', 'over', 'after', 'before', 'she', 'him', 'them',
]);

/** Les mots significatifs d'un texte, sans doublon, ramenés à leur radical. */
export function tokensOf(text: string): string[] {
  const plain = text.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  const words = plain.match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const stems = new Set<string>();
  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    stems.add(word.length > STEM_LENGTH ? word.slice(0, STEM_LENGTH) : word);
  }
  return [...stems];
}

/** Le texte porte-t-il le fait : la majeure partie des mots du fait s'y retrouve. */
export function carries(text: string, fact: string): boolean {
  const wanted = tokensOf(fact);
  if (wanted.length < MIN_TOKENS) return false;
  const present = new Set(tokensOf(text));
  const found = wanted.filter((token) => present.has(token)).length;
  return found / wanted.length >= CARRIES_RATIO;
}

export interface CorrectionFact {
  oldFact: string;
  newFact: string;
}

/** La ligne qu'une correction ajoute à une fiche : la forme corrigée, et ce qu'elle remplace. */
export function correctionLine(correction: CorrectionFact): string {
  return `CORRIGÉ : ${correction.newFact} (ne plus dire : ${correction.oldFact})`;
}

/**
 * S'assure que la fiche porte la forme corrigée de chaque correction. Si elle
 * dit encore l'ancien fait sans dire le nouveau, la correction est écrite à
 * la fin, dans le budget : ce qui précède cède la place, jamais elle.
 */
export function enforceCorrections(text: string, corrections: readonly CorrectionFact[], budget: number): string {
  let result = text;
  for (const correction of corrections) {
    if (!carries(result, correction.oldFact) || carries(result, correction.newFact)) continue;
    const line = correctionLine(correction);
    if (line.length + 1 > budget) continue;
    result = `${result}\n${line}`.length > budget ? `${result.slice(0, Math.max(0, budget - line.length - 1)).trimEnd()}\n${line}` : `${result}\n${line}`;
  }
  return result;
}
