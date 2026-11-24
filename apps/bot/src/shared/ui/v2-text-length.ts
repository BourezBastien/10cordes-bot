/**
 * Longueur du texte visible d'un message Components V2. Discord le plafonne
 * (4 000 caractères sur l'ensemble des composants) et refuse alors le
 * message entier : un panneau qui s'appuie sur du texte calculé (résumé
 * d'un modèle, paramètres d'actions, motifs d'écart) doit la mesurer avant
 * de s'envoyer.
 */

/** Propriétés d'un composant qui comptent comme du texte visible. */
const TEXT_KEYS: readonly string[] = ['content', 'label', 'placeholder'];

function lengthOf(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((total, child) => total + lengthOf(child), 0);
  if (node === null || typeof node !== 'object') return 0;
  // Un builder se lit par sa forme JSON ; un objet brut se lit tel quel.
  if (typeof (node as { toJSON?: unknown }).toJSON === 'function') return lengthOf((node as { toJSON: () => unknown }).toJSON());
  const record = node as Record<string, unknown>;
  const own = TEXT_KEYS.reduce((total, key) => total + (typeof record[key] === 'string' ? (record[key] as string).length : 0), 0);
  return own + lengthOf(record.components);
}

/** Somme des textes des composants du message, builders comme objets bruts. */
export function v2TextLength(payload: { components?: readonly unknown[] }): number {
  return lengthOf(payload.components ?? []);
}
