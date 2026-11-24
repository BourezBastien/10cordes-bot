import type { BotTool } from '@10cordes/shared';
import { ACTION_VERB_RE, POLITE_PREFACE_RE, QUESTION_MARKER_RE } from './request-intent.lexicon';

/**
 * Intention d'une demande, décidée AVANT son premier tour : orientée ACTION
 * (recette correspondante, verbe de mutation, tool modifiant nommé) ou simple
 * conversation. Elle fixe l'effort de raisonnement et, avec le moteur
 * multi-fournisseurs, la capacité de conversation (et donc le modèle) de toute
 * la requête.
 *
 * Le doute profite à la conversation. L'ancienne règle (« un tool modifiant
 * routé ») classait presque toute phrase réelle en action : un seul mot commun
 * de 4 lettres routait un tool, et 109 des 113 tours d'une nuit sont partis
 * sur chat.reasoning.
 */

/**
 * Nom de tool qui n'annonce qu'une lecture : il ne signale pas une action.
 * Fournisseurs : lister, contrôler une connexion, feuilleter un catalogue et
 * ouvrir le panneau ne modifient rien (lier une route ou écrire un fournisseur, si).
 */
const READ_ONLY_NAME_RE =
  /^(?:get|search|read|list|find|analyze|describe|lookup|fetch|calc|translate|wiki|dictionary|weather|server|blueprint|skills|activity|rules\.list$|web\.|openSkill$|tool-registry|provider\.(?:list|test|models)$|capability\.list$|providers\.panel$|records\.(?:collections|get|list|search)$|members\.(?:get|list|pick))/u;

/** Ce qui a fait reconnaître une action. */
export type IntentSignal = 'skill' | 'verb' | 'tool';

export interface RequestIntent {
  /** La demande appelle une action. */
  action: boolean;
  /** Premier signal à l'origine de l'action, null en conversation simple. */
  signal: IntentSignal | null;
  /** Recettes dont le déclencheur correspond à la demande (lignes `id | trigger`). */
  matchedSkills: string[];
  /** Tools modifiants NOMMÉS dans la demande (un tool simplement routé ne compte pas). */
  mutatingTools: string[];
}

/** Texte comparable : minuscules, mentions retirées, apostrophes et espaces normalisés. */
function normalize(request: string): string {
  return request
    .normalize('NFC')
    .toLowerCase()
    .replace(/<@!?\d+>|<@&\d+>/gu, ' ')
    .replace(/[’`]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

const firstIndex = (text: string, pattern: RegExp): number => text.match(pattern)?.index ?? -1;

/** Caractère qui prolonge un identifiant (lettre, chiffre, soulignement), ou l'un des séparateurs donnés. */
function continuesName(char: string | undefined, separators: string): boolean {
  return char !== undefined && (char === '_' || separators.includes(char) || /\p{L}|\p{N}/u.test(char));
}

/** Nom d'un tool écrit dans la demande, en entier (`deleteChannel`, `rules.set`). */
function namedIn(text: string, toolName: string): boolean {
  const name = toolName.toLowerCase();
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    if (!continuesName(text[at - 1], '.') && !continuesName(text[at + name.length], '')) return true;
  }
  return false;
}

/** Mots significatifs d'un déclencheur (5 lettres ou plus). */
function triggerWords(trigger: string): string[] {
  return trigger.toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]{5,}/gu) ?? [];
}

/**
 * Position, dans la demande, du mot qui fait correspondre un déclencheur, -1
 * s'il ne correspond pas. Un mot long (6 lettres et plus) commun suffit ;
 * sinon deux mots moyens. Évite les faux positifs sur les mots de liaison.
 */
function triggerMatchIndex(line: string, text: string): number {
  const separator = line.indexOf(' | ');
  const words = triggerWords(separator >= 0 ? line.slice(separator + 3) : line);
  let at = -1;
  let shared = 0;
  let hasLong = false;
  for (const word of words) {
    const index = text.indexOf(word);
    if (index < 0) continue;
    shared += 1;
    hasLong ||= word.length >= 6;
    at = at < 0 ? index : Math.min(at, index);
  }
  return hasLong || shared >= 2 ? at : -1;
}

export function detectRequestIntent(request: string, routedTools: readonly BotTool[], skillTriggers: readonly string[]): RequestIntent {
  // Une préface de capacité polie n'est pas une question : l'action qui la
  // suit compte (« est-ce que tu peux créer un système de tickets ? »).
  const text = normalize(request).replace(POLITE_PREFACE_RE, '').trimStart();
  // Une question porte sur le savoir-faire ou sur un fait : les verbes et les
  // recettes situés APRÈS son mot interrogatif ne comptent pas
  // (« comment supprimer un salon ? »). Un tool nommé, si.
  const questionAt = firstIndex(text, QUESTION_MARKER_RE);
  const isCommand = (at: number): boolean => at >= 0 && (questionAt < 0 || at < questionAt);

  const mutatingTools = routedTools.filter((tool) => !READ_ONLY_NAME_RE.test(tool.name) && namedIn(text, tool.name)).map((tool) => tool.name);
  const verbAt = firstIndex(text, ACTION_VERB_RE);
  const matchedSkills = skillTriggers.filter((line) => isCommand(triggerMatchIndex(line, text)));
  const signal: IntentSignal | null = mutatingTools.length > 0 ? 'tool' : isCommand(verbAt) ? 'verb' : matchedSkills.length > 0 ? 'skill' : null;
  return { action: signal !== null, signal, matchedSkills, mutatingTools };
}
