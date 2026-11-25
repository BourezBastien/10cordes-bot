/*
 * ACCESSEUR RUNTIME de l'extinction. La base (PrismaService, dans son module
 * global) doit attendre la fin des demandes en cours avant de se fermer ; le
 * service d'extinction dépend lui-même de la file, qui finit par la base. Un
 * accesseur levé à l'amorçage évite le cycle d'injection (même pattern que
 * getLlm).
 */

export interface ShutdownDrain {
  /** Vrai quand l'extinction a commencé : plus rien ne doit être accepté. */
  isDraining(): boolean;
  /** Attend la fin de la vidange, au plus `timeoutMs` (le délai de grâce par défaut). Rend vrai si tout est soldé, faux si le délai a passé. */
  drained(timeoutMs?: number): Promise<boolean>;
  /** Suit un travail en cours : l'extinction l'attend, sans en changer l'issue. */
  track<T>(work: Promise<T>): Promise<T>;
}

let drain: ShutdownDrain | null = null;

export function bindShutdown(service: ShutdownDrain): void {
  drain = service;
}

/** Sans extinction en cours (jamais amorcé, ou déjà soldé) : vrai aussitôt. */
export async function awaitShutdownDrained(timeoutMs?: number): Promise<boolean> {
  if (!drain || !drain.isDraining()) return true;
  return drain.drained(timeoutMs);
}

/**
 * Signale un travail en cours à l'extinction (une conversation venue du
 * web). Par l'accesseur, jamais par injection : le service d'extinction est un
 * fournisseur du module racine, qu'aucun autre module ne peut se faire
 * injecter, et le bot refusait de démarrer (25/11/2026). Sans service lié, le
 * travail suit son cours, simplement non suivi.
 */
export function trackForShutdown<T>(work: Promise<T>): Promise<T> {
  return drain ? drain.track(work) : work;
}
