import { Button, ModalComponent, ModalInput } from '@spraxium/components';

export const IA_CONFIG_BUTTON_ID = 'ia-config-open';
export const IA_CONFIG_MODAL_ID = 'ia-config';

@Button({ customId: IA_CONFIG_BUTTON_ID, label: "🔑 Connecter l'IA", style: 'primary' })
export class IaConfigureButton {}

/**
 * Modale de connexion du module IA — réservée à l'owner du serveur.
 * Base URL compatible OpenAI : DeepSeek, OpenRouter, ou self-hosted.
 * La clé PixelLab (optionnelle) connecte la génération d'icônes/emojis.
 */
@ModalComponent({ id: IA_CONFIG_MODAL_ID, title: 'Connecter le module IA' })
export class IaConfigureModal {
  @ModalInput({
    label: 'Base URL de l\'API (compatible OpenAI)',
    placeholder: 'https://api.deepseek.com ou https://openrouter.ai/api/v1',
    required: true,
  })
  baseurl!: string;

  @ModalInput({ label: 'Clé API', style: 'paragraph', placeholder: 'sk-...', required: true })
  apikey!: string;

  @ModalInput({ label: 'Modèle (optionnel)', placeholder: 'deepseek-flash' })
  model!: string;

  @ModalInput({
    label: 'Clé PixelLab (optionnel : icônes et emojis)',
    placeholder: 'pixl_...',
    required: false,
  })
  pixellabkey!: string;
}
