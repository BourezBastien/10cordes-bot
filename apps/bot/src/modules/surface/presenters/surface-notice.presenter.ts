import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { notice } from '../../../shared/ui';

/** Payload d'un message éphémère : texte Components V2. */
export interface EphemeralText {
  components: TextDisplayBuilder[];
}

/**
 * Messages éphémères d'une interaction de surface. Un clic n'est jamais
 * silencieux : acquitté dans les 3 s, puis remplacé par un message Components
 * V2 qui reste visible. POO pure : aucun appel Discord.
 */
export class SurfaceNoticePresenter {
  /** Drapeaux de l'accusé différé : éphémère et Components V2 dès la création (le drapeau V2 ne se pose qu'à la création). */
  deferredFlags(): number {
    return MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
  }

  /** Texte d'une étape `replyEphemeral` du pipeline. */
  pipeline(content: string): EphemeralText {
    return { components: [new TextDisplayBuilder().setContent(content.slice(0, 1000))] };
  }

  /** La surface n'existe plus, ou le binding a disparu de sa définition. */
  inactive(): EphemeralText {
    return notice('Cette action n\u0027est plus active.', true);
  }

  /** Le pipeline a refusé ou échoué : la raison reste utile au membre. */
  failed(message: string): EphemeralText {
    return notice(`Action impossible : ${message.slice(0, 300)}`, true);
  }

  /** Le pipeline a réussi sans étape de réponse. */
  done(): EphemeralText {
    return notice('Action exécutée.', true);
  }

  /** Exception inattendue du handler. */
  crashed(reference: string): EphemeralText {
    return notice(`Cette action a échoué [${reference}]. Réessaie, et signale cette référence au staff si ça se répète.`, true);
  }
}
