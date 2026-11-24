import { ProviderError } from '../provider.types';

/**
 * Identifiant d'un fournisseur, déduit de son nom à la création. Le slug est
 * l'identifiant : lettres minuscules, chiffres et tirets, 2 à 48 caractères
 * (règle du store). L'utilisateur ne le saisit jamais.
 */

/** Bornes d'un slug, identiques à la règle du store. */
const SLUG_MIN = 2;
const SLUG_MAX = 48;

/** Ramène un slug naissant dans les bornes : longueur, sans tiret final. */
function fit(slug: string): string {
  return slug.slice(0, SLUG_MAX).replace(/-+$/u, '');
}

/** Slug lisible depuis un nom : minuscules, sans accents, mots et nombres reliés par des tirets. */
export function slugFromName(name: string): string {
  return fit(
    name
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/['`\u2019]/gu, '')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/-+/gu, '-')
      .replace(/^-+/gu, ''),
  );
}

/** Slug d'un nouveau fournisseur : déduit du nom, refusé s'il ne reste rien d'exploitable. */
export function slugForProvider(name: string): string {
  const slug = slugFromName(name);
  if (slug.length < SLUG_MIN) {
    throw new ProviderError(`Nom invalide : écris au moins ${SLUG_MIN} lettres ou chiffres, le nom devient l\u0027identifiant du fournisseur.`, 'invalid');
  }
  return slug;
}

/** Slug libre sur un serveur : le souhaité, sinon `-2`, `-3`… */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = fit(`${base}-${index}`);
    if (!taken.has(candidate)) return candidate;
  }
  return fit(`${base}-${Date.now().toString(36)}`);
}
