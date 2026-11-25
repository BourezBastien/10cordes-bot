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
