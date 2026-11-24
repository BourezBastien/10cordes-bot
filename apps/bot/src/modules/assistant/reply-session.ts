/**
 * Silence demandé explicitement : filet déterministe en plus du tool skipReply
 * (le modèle peut l'ignorer ; cette détection, jamais).
 */
const SILENCE_REQUEST_RE = /sans\s+(?:me\s+)?répondre|ne\s+me\s+réponds\s+pas|without\s+(?:any\s+)?repl(?:y|ies)/i;

/** La demande textuelle exige-t-elle de n'envoyer aucune réponse ? */
export function isSilenceRequested(content: string): boolean {
  return SILENCE_REQUEST_RE.test(content);
}

/**
 * État vivant d'une réponse en cours : la seule chose qu'une demande impose
 * à sa livraison, le silence. Partagé par la construction du contexte,
 * l'exécution de la boucle et la livraison finale. La session n'a PAS accès au
 * salon : rien ne peut s'y afficher entre la demande et la réponse finale.
 */
export class ReplySession {
  /** Silence demandé (tool skipReply ou demande textuelle explicite). */
  silent: boolean;

  constructor(
    /** Vrai quand la demande textuelle exige le silence (filet déterministe). */
    silentRequested: boolean,
  ) {
    this.silent = silentRequested;
  }

  /** Le modèle demande explicitement de n'envoyer aucune réponse après les actions. */
  requestSilence(): void {
    this.silent = true;
  }
}
