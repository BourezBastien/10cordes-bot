import { ProviderError } from '../provider.types';

/**
 * Lecture des paramètres d'une capacité (`ProviderRequest.params`). Un
 * paramètre absent est omis de la requête ; un paramètre présent mais mal
 * typé est refusé ici, avec le nom du champ à corriger.
 */

export function optionalText(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProviderError(`Paramètre invalide : ${key} (texte non vide attendu).`, 'invalid');
  }
  return value;
}

export function requiredText(params: Record<string, unknown>, key: string): string {
  const value = optionalText(params, key);
  if (value === null) throw new ProviderError(`Paramètre manquant : ${key}`, 'invalid');
  return value;
}

/** Nombre strictement positif, entier si demandé. */
export function optionalNumber(params: Record<string, unknown>, key: string, integer: boolean): number | null {
  const value = params[key];
  if (value === undefined || value === null) return null;
  const valid = typeof value === 'number' && Number.isFinite(value) && value > 0 && (!integer || Number.isInteger(value));
  if (!valid) throw new ProviderError(`Paramètre invalide : ${key} (nombre ${integer ? 'entier ' : ''}positif attendu).`, 'invalid');
  return value;
}
