import { Injectable } from '@spraxium/common';

/**
 * Indicateur « écrit… » : la SEULE trace visible d'une demande en cours.
 *
 * Discord efface l'indicateur au bout de 10 secondes, ou dès qu'un message
 * part dans le salon : il est relancé toutes les 8 secondes, de l'acceptation
 * de la demande (attente en file comprise) à sa fin. Plusieurs demandes du
 * même salon tiennent chacune une part : la dernière relâchée l'éteint.
 */

/** Relance de l'indicateur : sous les 10 secondes de Discord. */
export const TYPING_REFRESH_MS = 8_000;
/** Garde-fou : une part jamais relâchée (traitement tué) n'affiche pas « écrit » pour toujours. */
export const TYPING_MAX_HOLD_MS = 30 * 60_000;

/** Ce qu'il faut d'un salon pour y afficher l'indicateur (structurel : sans discord.js). */
export interface TypingChannel {
  sendTyping(): Promise<unknown>;
}

interface Held {
  holds: number;
  timer: NodeJS.Timeout;
  startedAt: number;
}

@Injectable()
export class TypingIndicator {
  private readonly held = new Map<string, Held>();

  /** Affiche « écrit… » dans le salon jusqu'à l'appel du relâche rendu (idempotent). */
  hold(channelId: string, channel: TypingChannel): () => void {
    let entry = this.held.get(channelId);
    if (!entry) {
      entry = { holds: 0, startedAt: Date.now(), timer: setInterval(() => this.refresh(channelId, channel), TYPING_REFRESH_MS) };
      // Un indicateur en cours ne retient jamais la fin du processus.
      entry.timer.unref?.();
      this.held.set(channelId, entry);
      this.ping(channel);
    }
    entry.holds += 1;
    // La part ne connaît que SON indicateur : relâchée tardivement, elle n'éteint jamais celui d'une demande plus récente.
    const mine = entry;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      mine.holds -= 1;
      if (mine.holds <= 0) this.stop(channelId, mine);
    };
  }

  /** Salons où l'indicateur est affiché (diagnostic, tests). */
  get activeChannels(): string[] {
    return [...this.held.keys()];
  }

  private refresh(channelId: string, channel: TypingChannel): void {
    const entry = this.held.get(channelId);
    if (!entry) return;
    if (Date.now() - entry.startedAt >= TYPING_MAX_HOLD_MS) {
      this.stop(channelId, entry);
      return;
    }
    this.ping(channel);
  }

  /** L'indicateur est du mieux possible : un salon sans permission de parler n'arrête rien. */
  private ping(channel: TypingChannel): void {
    try {
      void Promise.resolve(channel.sendTyping()).catch(() => {});
    } catch {
      /* salon devenu inaccessible : rien à afficher */
    }
  }

  private stop(channelId: string, entry: Held): void {
    clearInterval(entry.timer);
    if (this.held.get(channelId) === entry) this.held.delete(channelId);
  }
}
