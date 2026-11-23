import type { TextChannel } from 'discord.js';
import { LlmStreamSanitizer } from './llm-stream.sanitizer';
import { DiscordProgressiveResponder } from './progressive-responder';
import { LiveStatus } from './live-status';

/** Texte interdit en flux (mention de masse ou demande de panneau) : le stream est coupé. */
const STREAM_STOP_RE = /@everyone|@here|\[PANEL/i;

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
 * État vivant d'une réponse en cours : ligne de statut unique, rédaction
 * progressive et silence demandé. Partagé par la construction du contexte,
 * l'exécution de la boucle et la livraison finale. C'est la DERNIÈRE barrière
 * avant Discord : aucun jeton interne du modèle ne franchit pushDelta.
 */
export class ReplySession {
  /** Silence demandé (tool skipReply ou demande textuelle explicite). */
  silent: boolean;
  /** Vrai tant que le texte en streaming peut encore être publié. */
  streamingActive: boolean;
  private streamedText = '';
  private readonly sanitizer = new LlmStreamSanitizer();

  readonly status: LiveStatus;
  readonly responder: DiscordProgressiveResponder;

  constructor(
    channel: TextChannel,
    messageId: string,
    /** Vrai quand la demande textuelle exige le silence (filet déterministe). */
    silentRequested: boolean,
  ) {
    this.silent = silentRequested;
    this.streamingActive = !silentRequested;
    this.status = new LiveStatus(channel);
    this.responder = new DiscordProgressiveResponder(channel, messageId);
  }

  /** Le modèle demande explicitement de n'envoyer aucune réponse après les actions. */
  requestSilence(): void {
    this.silent = true;
    this.streamingActive = false;
    void this.responder.abort();
  }

  /** Tour rejeté (balises internes, conclusion sans texte) : le stream est coupé et le brouillon publié est retiré. */
  rejectStream(): void {
    this.streamingActive = false;
    void this.responder.discard();
  }

  /**
   * Delta d'un tour SANS tool_calls (commit de fin d'itération par l'AgentLoop)
   * : poussé au responder d'un bloc. Un élément interdit (jeton interne,
   * mention de masse, demande de panneau) coupe le stream et la livraison
   * finale classique prend le relais.
   */
  pushDelta(text: string): void {
    if (!this.streamingActive) return;
    const safe = this.sanitizer.push(text);
    if (this.sanitizer.didLeak) {
      this.rejectStream();
      return;
    }
    if (!safe) return;
    this.streamedText += safe;
    if (STREAM_STOP_RE.test(this.streamedText)) {
      this.streamingActive = false;
      void this.responder.abort();
      return;
    }
    this.responder.push(safe);
  }
}
