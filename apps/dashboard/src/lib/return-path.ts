/*
 * RETOUR APRÈS LA CONNEXION. Un visiteur sans session est renvoyé à la page
 * de connexion avec le chemin qu'il voulait. Seuls les chemins des serveurs
 * sont repris : jamais une autre origine, jamais la page de connexion
 * elle-même.
 */

/** Le chemin demandé, s'il mène aux serveurs ; sinon rien. */
export function returnPath(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/guilds') ? value : undefined;
}

/** L'adresse de la page de connexion, qui ramènera au chemin demandé quand il est repris. */
export function loginPath(here: string): string {
  const back = returnPath(here);
  return back ? `/login?redirect=${encodeURIComponent(back)}` : '/login';
}
