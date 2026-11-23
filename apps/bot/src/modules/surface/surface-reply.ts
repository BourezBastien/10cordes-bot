import type { TextDisplayBuilder } from 'discord.js';
import type { SurfaceNoticePresenter } from './presenters/surface-notice.presenter';

/** Ce qu'une interaction de surface expose pour répondre (structurel, sans discord.js). */
export interface InteractionResponder {
  reply(options: { components: TextDisplayBuilder[]; flags: number }): Promise<unknown>;
  deferReply(options: { flags: number }): Promise<unknown>;
  editReply(options: { components: TextDisplayBuilder[] }): Promise<unknown>;
}

/**
 * Réponse éphémère à une interaction. Discord exige un accusé sous 3 s :
 * `defer()` pose un message éphémère V2 « Réflexion… », que `show()` remplace
 * ensuite par le message définitif. Celui-ci n'est JAMAIS supprimé : un
 * `deleteReply()` inconditionnel effaçait la réponse dès qu'elle apparaissait.
 */
export class InteractionReply {
  private acknowledged = false;
  private answered = false;

  constructor(
    private readonly interaction: InteractionResponder,
    private readonly presenter: SurfaceNoticePresenter,
  ) {}

  /** Acquitte l'interaction ; un échec d'acquittement ne doit pas interrompre le traitement. */
  async defer(): Promise<void> {
    this.acknowledged = true;
    await this.interaction.deferReply({ flags: this.presenter.deferredFlags() }).catch(() => {});
  }

  /** Vrai dès qu'un message définitif a été publié. */
  get isAnswered(): boolean {
    return this.answered;
  }

  /** Publie le message éphémère définitif (reply si rien n'est encore acquitté, sinon édition de l'accusé). */
  async show(payload: { components: TextDisplayBuilder[] }): Promise<void> {
    this.answered = true;
    if (!this.acknowledged) {
      this.acknowledged = true;
      await this.interaction.reply({ ...payload, flags: this.presenter.deferredFlags() }).catch(() => {});
      return;
    }
    await this.interaction.editReply(payload).catch(() => {});
  }
}
