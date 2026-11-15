import { Button, ChannelSelect, SelectOption, StringSelect } from '@spraxium/components';
import {
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
