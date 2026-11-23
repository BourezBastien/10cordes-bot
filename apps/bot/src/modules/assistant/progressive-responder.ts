/** Canal textuel minimal requis par le responder (structurel, sans discord.js). */
export interface ProgressiveChannel {
  send(options: { content: string; reply?: { messageReference: string; failIfNotExists?: boolean } }): Promise<{ id: string }>;
  messages: {
    edit(id: string, options: { content: string }): Promise<unknown>;
  };
}

/**
 * DiscordProgressiveResponder (Phase 2.2) : rendu PROGRESSIF d'une réponse
 * streamée dans un salon Discord.
 * - UN message qui grandit par éditions, jamais plus d'une édition toutes
 *   les THROTTLE_MS (1,8 s : limite stricte sous le rate-limit d'édition).
 * - Découpage : un message Discord plafonne à 2000 caractères ; au-delà, le
 *   message courant est finalisé et la suite part sur un nouveau message.
 * - Mode DRAFT : rien n'est publié avant le premier flush (délai throttle) ;
 *   si des tool_calls arrivent pendant ce délai, abort() ne publie RIEN.
 * - Le PREMIER message répond au message d'origine (failIfNotExists:false).
 */
export class DiscordProgressiveResponder {
  private static readonly THROTTLE_MS = 1_800;
  private static readonly MAX_CHUNK = 1_900; // marge markdown sous les 2000

  private buffer = '';
  private currentMessageId: string | null = null;
  private lastEditAt = 0;
  private firstFlushTimer: NodeJS.Timeout | null = null;
  private flushed = false;
  private closed = false;
  private currentContent = '';

  constructor(
    private readonly channel: ProgressiveChannel,
    private readonly replyToMessageId?: string,
  ) {}

  /** Vrai dès qu'un message est réellement publié en salon (plus annulable sans trace). */
  get published(): boolean {
    return this.flushed;
  }

  /** Delta de texte du stream : bufferisé, flush au throttle. */
  push(delta: string): void {
    if (this.closed) return;
    this.buffer += delta;
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.firstFlushTimer || this.flushed) return;
    const wait = Math.max(0, DiscordProgressiveResponder.THROTTLE_MS - (Date.now() - this.lastEditAt));
    this.firstFlushTimer = setTimeout(() => {
      this.firstFlushTimer = null;
      void this.flush();
    }, wait);
    this.firstFlushTimer.unref?.();
  }

  private async flush(): Promise<void> {
    if (this.closed || this.buffer.length === 0) return;
    if (Date.now() - this.lastEditAt < DiscordProgressiveResponder.THROTTLE_MS) {
      this.scheduleFlush();
      return;
    }
    // Découpage : si le buffer dépasse le plafond du message courant, on
    // coupe à la dernière limite sûre et le reste attendra le flush suivant.
    let toWrite = this.buffer;
    if ((this.currentLength + toWrite.length) > DiscordProgressiveResponder.MAX_CHUNK) {
      const room = DiscordProgressiveResponder.MAX_CHUNK - this.currentLength;
      if (room <= 0) {
        await this.rollNewMessage();
        return;
      }
      toWrite = toWrite.slice(0, room);
    }
    this.buffer = this.buffer.slice(toWrite.length);
    this.lastEditAt = Date.now();
    this.flushed = true;
    try {
      if (this.currentMessageId) {
        await this.channel.messages.edit(this.currentMessageId, { content: this.currentContent + toWrite }).catch(() => {});
        this.currentContent += toWrite;
      } else {
        const sent = await this.channel
          .send({
            content: toWrite,
            ...(this.replyToMessageId
              ? { reply: { messageReference: this.replyToMessageId, failIfNotExists: false } }
              : {}),
          })
          .catch(() => null);
        if (sent) {
          this.currentMessageId = sent.id;
          this.currentContent = toWrite;
        }
      }
    } finally {
      if (this.buffer.length > 0) this.scheduleFlush();
    }
  }

  private get currentLength(): number {
    return this.currentContent.length;
  }

  /** Le message courant est complet : la suite ira sur un nouveau message. */
  private async rollNewMessage(): Promise<void> {
    await this.flush().catch(() => {});
    this.currentMessageId = null;
    this.currentContent = '';
    await this.flush().catch(() => {});
  }

  /** Fin du stream : flush du reste. */
  async finalize(): Promise<void> {
    this.closed = true;
    if (this.firstFlushTimer) {
      clearTimeout(this.firstFlushTimer);
      this.firstFlushTimer = null;
    }
    while (this.buffer.length > 0) {
      const before = this.buffer.length;
      await this.flush().catch(() => {});
      if (this.buffer.length === before) {
        // Throttle encore actif : attends sa fenêtre puis retente UNE fois.
        await new Promise((resolve) => setTimeout(resolve, DiscordProgressiveResponder.THROTTLE_MS));
        await this.flush().catch(() => {});
        break;
      }
    }
  }

  /**
   * Annulation (tool_calls arrivés en cours de stream) : si RIEN n'a été
   * publié, le draft est jeté silencieusement ; sinon le message déjà
   * visible est finalisé tel quel (jamais de message tronqué supprimé).
   */
  async abort(): Promise<void> {
    if (this.flushed) {
      await this.finalize();
      return;
    }
    this.closed = true;
    if (this.firstFlushTimer) {
      clearTimeout(this.firstFlushTimer);
      this.firstFlushTimer = null;
    }
    this.buffer = '';
  }
}
