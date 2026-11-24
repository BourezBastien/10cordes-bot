import { ProviderError } from '../provider.types';

/**
 * Gabarits d'une opération sur mesure. Dans toute chaîne, `{{param}}` devient
 * String(valeur) ; une chaîne qui est EXACTEMENT `{{param}}` devient la valeur
 * typée (nombre, booléen, objet, tableau, null). Un paramètre manquant est
 * refusé avant l'appel.
 */

const PLACEHOLDER = /\{\{\s*([^{}\s]+)\s*\}\}/gu;
const WHOLE_PLACEHOLDER = /^\{\{\s*([^{}\s]+)\s*\}\}$/u;

/** Par quoi une valeur insérée dans le chemin changerait la structure de l'URL : query, fragment, séparation, remontée de dossier. */
const UNSAFE_IN_PATH = /[?#\\\u0000-\u001f\u007f]|(?:^|\/)\.{1,2}(?:\/|$)/u;

function paramValue(params: Record<string, unknown>, name: string): unknown {
  // Propriété propre seulement : `constructor` ou `toString` ne sont pas des paramètres.
  if (!Object.hasOwn(params, name) || params[name] === undefined) {
    throw new ProviderError(`Paramètre manquant : ${name}`, 'invalid');
  }
  return params[name];
}

/** Chaîne rendue : chaque `{{param}}` remplacé par String(valeur). */
export function renderString(template: string, params: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => String(paramValue(params, name)));
}

/** Valeur de gabarit rendue : la valeur typée pour un gabarit exact, la chaîne rendue sinon ; objets et tableaux parcourus. */
export function renderValue(template: unknown, params: Record<string, unknown>): unknown {
  if (typeof template === 'string') {
    const whole = template.match(WHOLE_PLACEHOLDER);
    return whole ? paramValue(params, whole[1]) : renderString(template, params);
  }
  if (Array.isArray(template)) return template.map((item) => renderValue(item, params));
  if (template && typeof template === 'object') {
    return Object.fromEntries(Object.entries(template).map(([key, value]) => [key, renderValue(value, params)]));
  }
  return template;
}

/** Chemin rendu : une valeur y est insérée telle quelle, sans pouvoir injecter de query ni remonter un dossier. */
export function renderPath(path: string, params: Record<string, unknown>): string {
  return path.replace(PLACEHOLDER, (_match, name: string) => {
    const text = String(paramValue(params, name));
    if (UNSAFE_IN_PATH.test(text)) throw new ProviderError(`Paramètre refusé dans le chemin : ${name}`, 'invalid');
    return text;
  });
}

/** En-têtes ou paramètres de requête rendus (toujours des chaînes) ; undefined si absents. */
export function renderStrings(record: Record<string, string> | undefined, params: Record<string, unknown>): Record<string, string> | undefined {
  return record && Object.fromEntries(Object.entries(record).map(([key, value]) => [key, renderString(value, params)]));
}
