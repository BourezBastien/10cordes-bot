import type { Message } from 'discord.js';
import { READING_LINE } from './investigation.policy';

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
  /** Dernier texte affiché, et si la ligne de lecture a déjà été posée pour cette demande. */
  private lastContent = '';
  private readingShown = false;

  constructor(
    private readonly channel: { send: (opts: { content: string }) => Promise<Message> },
    private readonly readingLine: string = READING_LINE,
  ) {}

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

  /**
   * Lecture de recherche (investigation silencieuse) : dit UNE fois que le
   * bot consulte ses sources, puis ne bouge plus, quels que soient le nombre
   * de lectures. Une ligne [TOOL] déjà affichée (une action a commencé) est
   * laissée telle quelle : elle dit quelque chose de plus important.
   */
  async reading(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.readingShown || (this.message && this.lastContent.startsWith('[TOOL]'))) return;
    this.readingShown = true;
    await this.post(this.readingLine);
  }

  /** Détail de progression DANS la ligne du tool (ex : 24/48 salons). */
  async detail(text: string): Promise<void> {
    await this.post(`[TOOL] ${text}`);
  }

  private async post(content: string): Promise<void> {
    this.lastContent = content;
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
    this.lastContent = '';
    this.readingShown = false;
  }
}
