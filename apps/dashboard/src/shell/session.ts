import { redirect } from '@tanstack/react-router';
import { authClient } from '@/lib/auth';
import { returnPath } from '@/lib/return-path';

/*
 * SESSION. Le routeur vérifie une session avant d'ouvrir une page protégée
 * (`requireSession`), une fois par chargement de page : ensuite, toute
 * réponse 401 de l'API renvoie à la connexion (lib/api.ts). Le visiteur part
 * avec le chemin qu'il voulait quand il mène aux serveurs (lib/return-path.ts) :
 * la connexion le lui rend.
 */

let alive: Promise<boolean> | null = null;

/** Une session est-elle ouverte ? Un échec réseau passe : l'API répondra 401 s'il n'y en a pas. */
export function sessionAlive(): Promise<boolean> {
  alive ??= authClient.getSession().then(
    ({ data }) => data !== null,
    () => true,
  );
  return alive;
}

/** Garde d'une page protégée : sans session, renvoie à la page de connexion, qui ramènera à la page demandée. */
export async function requireSession(): Promise<void> {
  if (await sessionAlive()) return;
  const back = returnPath(window.location.pathname + window.location.search);
  if (back) throw redirect({ to: '/login', search: { redirect: back } });
  throw redirect({ to: '/login' });
}

/** Déconnexion, puis retour à la page de connexion par un chargement complet. */
export function signOut(): void {
  const leave = () => window.location.assign('/login');
  void authClient.signOut({ fetchOptions: { onSuccess: leave, onError: leave } });
}
