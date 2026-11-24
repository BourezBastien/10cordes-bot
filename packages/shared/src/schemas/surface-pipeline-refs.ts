import type { PipelineStep } from './surface-pipeline-step.js';

/**
 * Références `{{steps.N.<champ>}}` d'un pipeline, vérifiées AVANT qu'il soit
 * enregistré. À l'exécution, une référence qui ne résout pas devient une
 * chaîne vide, sans erreur : un panneau de tickets accepté avec
 * `{{steps.0.data.id}}` donnait un bouton muet au clic.
 *
 * L'exécuteur tient UN tableau `steps` par exécution, partagé entre un
 * pipeline et ses sous-pipelines `if` et `forEach` ; un pipeline planifié
 * (`trigger.schedule`) repart d'un tableau vide. Le résultat d'un outil est
 * rangé À PLAT dans son étape. Une référence est sûre seulement si son numéro
 * désigne une étape qui existe déjà et dont le numéro ne dépend d'aucune
 * branche ni d'aucun tour de boucle :
 *
 *   - `{{steps.N.data.x}}` est refusé : le champ se lit directement ;
 *   - une étape postérieure ou inexistante est refusée ;
 *   - à partir d'un `if` ou d'un `forEach`, plus aucune étape n'a de numéro
 *     fixe (la branche prise, ou le nombre de tours, décale les suivantes).
 * Le remède est le même dans les deux cas : la valeur passe par l'état
 * (`setState`, puis `{{state.x}}`).
 */

/** Clés d'une étape qui portent un sous-pipeline : vérifié pour son propre compte. */
const NESTED_KEYS: ReadonlySet<string> = new Set(['then', 'else', 'steps']);

/** Toutes les références `{{...}}` d'un texte, chemin du champ compris. */
const REFERENCE_RE = /\{\{([^{}]*)\}\}/gu;
/** `steps` seul, ou `steps.` suivi du reste : le numéro et le champ attendus. */
const STEP_REFERENCE_RE = /^steps(?:\.(.*))?$/u;
const DIGITS_RE = /^\d+$/u;

interface Reference {
  /** Chemin du champ qui la porte (`input.channelId`). */
  field: string;
  /** Chemin référencé, sans les accolades ni les espaces. */
  path: string;
}

/** Où s'exécute un tableau d'étapes, dans le tableau partagé de l'exécution. */
interface Frame {
  /** Index, dans le tableau partagé, de la première étape de ce tableau. */
  readonly offset: number;
  /** Premier index du tableau partagé dont le numéro n'est pas fixe (branche prise, tours d'une boucle), hérité des tableaux englobants. */
  readonly uncertainFrom: number;
  /** Premier index du tableau partagé qui appartient au corps d'une boucle : il change à chaque tour. */
  readonly shiftingFrom: number;
}

const TOP: Frame = { offset: 0, uncertainFrom: Number.POSITIVE_INFINITY, shiftingFrom: Number.POSITIVE_INFINITY };

/** Références portées par les champs d'une étape, sous-pipelines exclus. */
function referencesOf(step: PipelineStep): Reference[] {
  const found: Reference[] = [];
  const visit = (value: unknown, field: string): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(REFERENCE_RE)) found.push({ field, path: (match[1] ?? '').trim() });
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${field}.${index}`));
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) visit(item, `${field}.${key}`);
    }
  };
  for (const [key, value] of Object.entries(step)) {
    if (!NESTED_KEYS.has(key)) visit(value, key);
  }
  return found;
}

/** Pourquoi une référence est fausse ; null si elle est sûre ou ne désigne pas une étape. */
function flawOf(path: string, index: number, frame: Frame, certainUntil: number): string | null {
  const match = path.match(STEP_REFERENCE_RE);
  if (!match) return null;
  const tail = (match[1] ?? '').trim();
  const dot = tail.indexOf('.');
  const digits = dot === -1 ? tail : tail.slice(0, dot);
  const field = dot === -1 ? '' : tail.slice(dot + 1).trim();
  if (!DIGITS_RE.test(digits)) return `numéro d\u0027étape attendu, sous la forme {{steps.0.<champ>}}`;
  if (field === 'data' || field.startsWith('data.')) return 'le résultat d\u0027un outil se lit sans `data` : le champ se met directement après le numéro';
  const target = Number(digits);
  // Ce qui est vraiment lisible ici : les étapes précédentes, hors celles dont le numéro n\u0027est pas fixe.
  const readableCount = Math.min(frame.offset + index, frame.uncertainFrom, frame.shiftingFrom, frame.offset + certainUntil);
  const readable = readableCount <= 0 ? 'aucune étape n\u0027est lisible ici' : `étapes lisibles à cet endroit : 0 à ${readableCount - 1}`;
  if (target >= frame.shiftingFrom) {
    return `dans ou après un « forEach », chaque tour ajoute ses étapes au même tableau : ce numéro n\u0027est pas fixe. Range la valeur dans l\u0027état (setState) et lis-la par {{state.x}} (${readable})`;
  }
  if (target >= frame.offset + index) return `l\u0027étape ${target} n\u0027existe pas encore à cette position (${readable})`;
  if (target >= Math.min(frame.uncertainFrom, frame.offset + certainUntil)) {
    return `les étapes d\u0027un « if » ou d\u0027un « forEach », et celles qui les suivent, n\u0027ont pas de numéro fixe (il dépend de la branche prise ou du nombre de tours). Range la valeur dans l\u0027état (setState) et lis-la par {{state.x}} (${readable})`;
  }
  return null;
}

/** Vérifie un tableau d'étapes ; les sous-pipelines sont vérifiés pour leur propre compte. */
function walk(steps: readonly PipelineStep[], frame: Frame, label: string, errors: string[]): void {
  // Index, dans ce tableau, du premier « if » ou « forEach » : à partir de lui, les numéros des étapes suivantes ne sont pas fixes.
  let certainUntil = steps.length;
  for (const [index, step] of steps.entries()) {
    const place = `${label}, étape ${index + 1} (${step.type})`;
    for (const reference of referencesOf(step)) {
      const flaw = flawOf(reference.path, index, frame, certainUntil);
      if (flaw) errors.push(`{{${reference.path}}} dans ${reference.field}, ${place} : ${flaw}.`);
    }
    if (step.type !== 'if' && step.type !== 'forEach' && step.type !== 'trigger.schedule') continue;
    // Le sous-pipeline commence à la place de son étape de contrôle. Ses propres étapes y ont un
    // numéro fixe ; ce qui ne l'est pas, c'est ce qui l'était déjà dans le tableau parent à partir
    // de sa première étape de contrôle (`certainUntil`, pas encore modifié par l'étape en cours).
    const nested: Frame = { offset: frame.offset + index, uncertainFrom: Math.min(frame.uncertainFrom, frame.offset + certainUntil), shiftingFrom: frame.shiftingFrom };
    if (step.type === 'if') {
      // Les branches commencent à la place du « if » : elles lisent les étapes d'avant et les leurs.
      walk(step.then, nested, `${place}, branche alors`, errors);
      if (step.else) walk(step.else, nested, `${place}, branche sinon`, errors);
      certainUntil = Math.min(certainUntil, index);
    } else if (step.type === 'forEach') {
      walk(step.steps, { ...nested, shiftingFrom: Math.min(frame.shiftingFrom, frame.offset + index) }, `${place}, corps de boucle`, errors);
      certainUntil = Math.min(certainUntil, index);
    } else {
      // Planifié : il s\u0027exécutera plus tard, avec son propre tableau d\u0027étapes.
      walk(step.steps, TOP, `${place}, pipeline planifié`, errors);
    }
  }
}

/**
 * Références d'étape fausses d'un pipeline, avec le champ et l'étape qui les
 * portent. Le résultat d'un outil appelé à l'étape N se lit `{{steps.N.<champ>}}`.
 */
export function validateStepReferences(steps: readonly PipelineStep[], label: string): string[] {
  const errors: string[] = [];
  walk(steps, TOP, label, errors);
  return errors;
}
