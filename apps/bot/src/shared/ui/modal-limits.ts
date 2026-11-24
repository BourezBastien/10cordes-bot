import type { APIModalInteractionResponseCallbackData } from 'discord.js';

/**
 * Limites Discord d'une modale, vérifiées AVANT l'envoi. Au-delà, Discord
 * rejette toute l'interaction (`data.components[BASE_TYPE_MAX_LENGTH]`) et le
 * clic reste sans réponse. Le 24/11, la modale « Fournisseur IA » portait six
 * champs : « Ajouter un fournisseur » n'a jamais ouvert.
 */

/** Composants d'une modale (un label par champ), limite Discord : entre 1 et 5. */
export const MODAL_MAX_COMPONENTS = 5;
/** Caractères du titre, limite Discord. */
export const MODAL_TITLE_MAX = 45;

/** Une modale que Discord refuserait : à attraper avant le showModal, jamais à envoyer. */
export class ModalLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModalLimitError';
  }
}

/** Ce qu'il faut d'une modale pour la vérifier : son titre et ses composants. */
export type ModalShape = Pick<APIModalInteractionResponseCallbackData, 'title' | 'components'>;

/** Lève `ModalLimitError` si Discord refuserait la modale ; `name` la désigne dans le message. */
export function assertModalFits(modal: ModalShape, name = 'Modale'): void {
  const count = modal.components.length;
  if (count < 1 || count > MODAL_MAX_COMPONENTS) {
    throw new ModalLimitError(`${name} : ${count} champ(s), Discord en accepte entre 1 et ${MODAL_MAX_COMPONENTS}.`);
  }
  if (modal.title.length > MODAL_TITLE_MAX) {
    throw new ModalLimitError(`${name} : titre de ${modal.title.length} caractères, Discord en accepte ${MODAL_TITLE_MAX}.`);
  }
}
