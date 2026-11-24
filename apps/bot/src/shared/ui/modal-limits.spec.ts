import { describe, expect, it } from 'vitest';
import { ComponentType, type APIModalInteractionResponseCallbackData } from 'discord.js';
import { ModalLimitError, assertModalFits, MODAL_MAX_COMPONENTS, MODAL_TITLE_MAX } from './modal-limits';

/**
 * Limites Discord d'une modale. Le 24/11, la modale « Fournisseur IA » portait
 * six champs : Discord la rejetait entière et le clic restait muet.
 */

type Modal = Pick<APIModalInteractionResponseCallbackData, 'title' | 'components'>;

/** Modale de n champs (un label par champ). */
function modal(fields: number, title = 'Titre'): Modal {
  return {
    title,
    components: Array.from({ length: fields }, (_, index) => ({
      type: ComponentType.Label,
      label: `Champ ${index}`,
      component: { type: ComponentType.TextInput, custom_id: `f${index}`, style: 1 },
    })) as unknown as Modal['components'],
  };
}

describe('assertModalFits', () => {
  it.each([1, 3, MODAL_MAX_COMPONENTS])('%i champ(s) : accepté', (fields) => {
    expect(() => assertModalFits(modal(fields), 'Test')).not.toThrow();
  });

  it('au-delà de cinq champs : refusé avant l\u0027envoi, le compte est dit', () => {
    expect(() => assertModalFits(modal(6), 'Modale « Fournisseur IA »')).toThrow(ModalLimitError);
    expect(() => assertModalFits(modal(6), 'Modale « Fournisseur IA »')).toThrow('Modale « Fournisseur IA » : 6 champ(s), Discord en accepte entre 1 et 5.');
  });

  it('aucun champ : refusé, Discord exige au moins un', () => {
    expect(() => assertModalFits(modal(0))).toThrow('0 champ(s)');
  });

  it('titre au-delà de 45 caractères : refusé', () => {
    expect(() => assertModalFits(modal(2, 'a'.repeat(MODAL_TITLE_MAX)))).not.toThrow();
    expect(() => assertModalFits(modal(2, 'a'.repeat(MODAL_TITLE_MAX + 1)))).toThrow('titre de 46 caractères');
  });
});
