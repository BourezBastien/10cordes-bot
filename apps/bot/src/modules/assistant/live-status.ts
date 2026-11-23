import type { Message } from 'discord.js';

/**
 * Ligne de statut UNIQUE pendant le traitement : éditée en place, jamais
 * dupliquée. Format demandé par l'owner : préfixe de tag, zéro emoji.
 *   [THINKING] Je réfléchis...
 *   [TOOL] analyzeActivity : 24/48 salons...
 * Supprimée juste avant la réponse finale.
 */
export class LiveStatus {
  private message: Message | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly channel: { send: (opts: { content: string }) => Promise<Message> }) {}

  /** Programme la ligne [THINKING] : postée seulement si rien ne répond en 3s. */
  arm(): void {
    this.timer = setTimeout(() => void this.post('[THINKING] Je réfléchis...'), 3_000);
    this.timer.unref?.();
  }

  /** Narration du texte intermédiaire d'une itération À tool_calls (R0.2) :
   * jamais publié comme réponse : la ligne [TOOL] le résume en direct. */
  async narrate(text: string): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const compact = text.replace(/\s+/gu, ' ').trim().slice(0, 90);
    if (compact.length === 0) return;
    await this.post(`[THINKING] ${compact}`);
  }

  /** Étape visible (appel de tool) : annule le timer et met à jour. */
  async step(toolName: string): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.post(`[TOOL] ${toolName}`);
  }

  /** Détail de progression DANS la ligne du tool (ex : 24/48 salons). */
  async detail(text: string): Promise<void> {
    await this.post(`[TOOL] ${text}`);
  }

  private async post(content: string): Promise<void> {
    if (this.message) {
      await this.message.edit({ content }).catch(() => {});
      return;
    }
    this.message = await this.channel.send({ content }).catch(() => null);
  }

  /** Supprime la ligne de statut (idempotent). */
  async done(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.message) {
      await this.message.delete().catch(() => {});
      this.message = null;
    }
  }
}
