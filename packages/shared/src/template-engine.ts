export type TemplateVars = Record<string, string | number | null | undefined>;

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Rend un template `{{dotted.key}}` avec les variables fournies.
 * - Variable présente mais null/undefined → remplacée par une chaîne vide.
 * - Token inconnu (absent des vars) → laissé intact, pour faciliter le debug des templates.
 */
export function renderTemplate(template: string, vars: TemplateVars = {}): string {
  return template.replace(TOKEN_PATTERN, (match: string, key: string) => {
    if (!(key in vars)) return match;
    const value = vars[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

/** Liste les variables référencées par un template, sans doublons, dans l'ordre d'apparition. */
export function templateVariables(template: string): string[] {
  const keys: string[] = [];
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const key = match[1];
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}
