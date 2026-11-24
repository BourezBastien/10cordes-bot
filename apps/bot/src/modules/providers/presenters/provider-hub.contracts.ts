/**
 * Contrat des customIds du panneau « Fournisseurs et modèles ».
 *
 * Le dispatcher de @spraxium/components route une interaction sur la BASE de
 * son customId (tout ce qui précède le premier `~`) ; l'état du panneau
 * voyage dans les paramètres qui suivent, relus par `parseHubParams` :
 *
 *   provider:select~c=<capacité>                     menu des fournisseurs
 *   provider:capability~p=<fournisseur>              menu des capacités
 *   provider:model~p=<f>~c=<capacité>~n=<page>       menu des modèles
 *   provider:add
 *   provider:edit~p=<f>
 *   provider:test~p=<f>~c=<capacité>~n=<page>
 *   provider:refresh~p=<f>~c=<capacité>~n=<page>
 *   provider:page~p=<f>~c=<capacité>~n=<page>
 *   provider:delete~p=<f>~c=<capacité>
 *   provider-edit~p=<f>&m=<message>                 modale « Fournisseur IA »
 *
 * Un customId ne dépasse jamais 100 caractères (limite Discord).
 */

/** Bases des customIds : ce que le dispatcher compare, et ce que portent les classes décorées. */
export const PROVIDER_HUB_IDS = {
  select: 'provider:select',
  capability: 'provider:capability',
  model: 'provider:model',
  add: 'provider:add',
  edit: 'provider:edit',
  test: 'provider:test',
  delete: 'provider:delete',
  refresh: 'provider:refresh',
  page: 'provider:page',
  /** Modale d'ajout et de modification. */
  modal: 'provider-edit',
} as const;

/** Labels des boutons, un seul emoji chacun : partagés par le presenter et les classes décorées. */
export const PROVIDER_HUB_LABELS = {
  add: '➕ Ajouter',
  edit: '✏️ Modifier',
  test: '🧪 Tester',
  refresh: '🔄 Actualiser',
  delete: '🗑️ Supprimer',
  previous: '◀️ Précédent',
  next: '▶️ Suivant',
} as const;

/** Options sentinelles : un menu a toujours au moins une option. */
export const HUB_ADD = '__add';
export const HUB_EMPTY = '__empty';

/** Options d'un menu, limite Discord (et donc taille d'une page du catalogue). */
export const PROVIDER_HUB_PAGE_SIZE = 25;

/** Longueur maximale d'un customId, limite Discord. */
const CUSTOM_ID_MAX = 100;

/** État porté par un customId ; seuls les paramètres fournis sont écrits. */
export interface HubRef {
  /** Fournisseur sélectionné (identifiant). */
  p?: string | null;
  /** Capacité sélectionnée. */
  c?: string | null;
  /** Page du menu des modèles (à partir de 1). */
  n?: number;
}

/** Valeur sans `~` ni `&`, les deux séparateurs que l'analyseur lit. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/~/gu, '%7E');
}

/** `base~p=<fournisseur>~c=<capacité>~n=<page>`, borné à 100 caractères. */
export function hubId(base: string, ref: HubRef = {}): string {
  const parts = [base];
  if (ref.p) parts.push(`p=${encode(ref.p)}`);
  if (ref.c) parts.push(`c=${encode(ref.c)}`);
  if (ref.n !== undefined) parts.push(`n=${ref.n}`);
  return parts.join('~').slice(0, CUSTOM_ID_MAX);
}
