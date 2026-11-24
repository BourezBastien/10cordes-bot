/**
 * État du panneau « Fournisseurs et modèles », tel qu'il voyage dans un
 * customId. Le dispatcher de @spraxium/components ne route que sur la base
 * (avant le premier `~`) : les paramètres qui suivent sont lus ici.
 */

/** État complet ; absent d'un customId, un paramètre vaut `null` (page 1). */
export interface HubParams {
  /** Fournisseur sélectionné (identifiant). */
  p: string | null;
  /** Capacité sélectionnée. */
  c: string | null;
  /** Page du menu des modèles (à partir de 1). */
  n: number;
  /** Message du panneau à l'origine d'une modale (modale seule). */
  m: string | null;
}

/** Un paramètre : une lettre, `=`, une valeur. */
const PART = /^([a-z])=(.*)$/u;

function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Page valide (à partir de 1) : une valeur absente ou aberrante ramène à la première. */
export function hubPage(raw: string | number | null): number {
  const page = Math.trunc(Number(raw));
  return Number.isFinite(page) && page >= 1 ? page : 1;
}

/**
 * Lit les paramètres d'un customId. Les segments sont séparés par `~`
 * (composants du panneau) ou par `&` (modale construite par ModalService) ;
 * la base et tout segment méconnaissable sont ignorés.
 */
export function parseHubParams(customId: string): HubParams {
  const params: HubParams = { p: null, c: null, n: 1, m: null };
  for (const segment of customId.split('~').slice(1)) {
    for (const part of segment.split('&')) {
      const match = part.match(PART);
      if (!match) continue;
      const [, key, raw] = match;
      const value = decode(raw);
      if (key === 'n') params.n = hubPage(value);
      else if (value && (key === 'p' || key === 'c' || key === 'm')) params[key] = value;
    }
  }
  return params;
}
