import { Button, ChannelSelect, SelectOption, StringSelect } from '@spraxium/components';
import {
  SETUP_ASSISTANT_CHANNEL_ID,
  SETUP_ASSISTANT_CLEAR_ID,
  SETUP_LANGUAGE_SELECT_ID,
  SETUP_WELCOME_CHANNEL_ID,
  SETUP_WELCOME_TOGGLE_ID,
} from './setup.ids';

@SelectOption({ label: 'English', value: 'en' })
@SelectOption({ label: 'Français', value: 'fr' })
@StringSelect({
  customId: SETUP_LANGUAGE_SELECT_ID,
  placeholder: 'Langue par défaut du serveur',
})
export class SetupLanguageSelect {}

@ChannelSelect({ customId: SETUP_WELCOME_CHANNEL_ID, placeholder: 'Salon de bienvenue' })
export class SetupWelcomeChannelSelect {}

@Button({ customId: SETUP_WELCOME_TOGGLE_ID, label: '👋 Welcome on/off', style: 'primary' })
export class SetupWelcomeToggle {}

@ChannelSelect({ customId: SETUP_ASSISTANT_CHANNEL_ID, placeholder: "Salon dédié de l'IA (agentic)" })
export class SetupAssistantChannelSelect {}

@Button({ customId: SETUP_ASSISTANT_CLEAR_ID, label: '🤖 IA partout (retirer le salon)', style: 'secondary' })
export class SetupAssistantClear {}
