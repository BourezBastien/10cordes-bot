import { Button, ChannelSelect, RoleSelect, StringSelect } from '@spraxium/components';

export const SETUP_BACK_ID = 'setup:back';
export const SETUP_CATEGORY_SELECT_ID = 'setup:category';
export const SETUP_MODULES_PICK_ID = 'setup:modules-pick';
export const SETUP_MODULES_ENABLE_ID = 'setup:modules-enable';
export const SETUP_MODULES_DISABLE_ID = 'setup:modules-disable';
export const SETUP_WELCOME_CHANNEL_ID = 'setup:welcome-channel';
export const SETUP_WELCOME_AUTOROLE_ID = 'setup:welcome-autorole';
export const SETUP_WELCOME_TOGGLE_ID = 'setup:welcome-toggle';
export const SETUP_WELCOME_DELETELEAVE_ID = 'setup:welcome-deleteleave';
export const SETUP_LOGS_CAT_SELECT_ID = 'setup:logs-cat';
export const SETUP_LOGS_CHANNEL_ID = 'setup:logs-channel';
export const SETUP_TICKETS_CATEGORY_ID = 'setup:tickets-category';
export const SETUP_TICKETS_STAFF_ID = 'setup:tickets-staff';
export const SETUP_TICKETS_PANEL_ID = 'setup:tickets-panel';
export const SETUP_TICKETS_LOGS_ID = 'setup:tickets-logs';
export const SETUP_TICKETS_POST_ID = 'setup:tickets-post';
export const SETUP_ROLES_ADD_ID = 'setup:roles-add';
export const SETUP_ROLES_CHANNEL_ID = 'setup:roles-channel';
export const SETUP_ROLES_POST_ID = 'setup:roles-post';
export const SETUP_ROLES_REFRESH_ID = 'setup:roles-refresh';
export const SETUP_LEVELS_CHANNEL_ID = 'setup:levels-channel';
export const SETUP_LEVELS_TOGGLE_ID = 'setup:levels-toggle';
export const SETUP_MOD_CHANNEL_ID = 'setup:mod-channel';
export const SETUP_MOD_DERANK_ID = 'setup:mod-derank';
export const SETUP_CONFIG_KEY_SELECT_ID = 'setup:config-key';
export const SETUP_LANGUAGE_SELECT_ID = 'setup:language';
export const SETUP_ASSISTANT_CLEAR_ID = 'setup:assistant-clear';
export const SETUP_CONFIG_VALUE_MODAL_ID = 'setup:config-value';

@StringSelect({
  customId: SETUP_CATEGORY_SELECT_ID,
  placeholder: 'Choisis une catégorie à configurer',
})
export class SetupCategorySelect {}

@Button({ customId: SETUP_BACK_ID, label: '⬅ Retour au menu', style: 'secondary' })
export class SetupBackButton {}

@StringSelect({ customId: SETUP_MODULES_PICK_ID, placeholder: 'Choisis un module' })
export class SetupModulesPick {}

@Button({ customId: SETUP_MODULES_ENABLE_ID, label: '✅ Activer', style: 'success' })
export class SetupModulesEnable {}

@Button({ customId: SETUP_MODULES_DISABLE_ID, label: '🚫 Désactiver', style: 'danger' })
export class SetupModulesDisable {}

@ChannelSelect({ customId: SETUP_WELCOME_CHANNEL_ID, placeholder: 'Salon de bienvenue' })
export class SetupWelcomeChannelSelect {}

@RoleSelect({ customId: SETUP_WELCOME_AUTOROLE_ID, placeholder: "Auto-rôle à l'arrivée" })
export class SetupWelcomeAutoroleSelect {}

@Button({ customId: SETUP_WELCOME_TOGGLE_ID, label: '👋 Welcome on/off', style: 'primary' })
export class SetupWelcomeToggle {}

@Button({ customId: SETUP_WELCOME_DELETELEAVE_ID, label: '🧹 Delete on leave', style: 'secondary' })
export class SetupWelcomeDeleteLeave {}

@StringSelect({ customId: SETUP_LOGS_CAT_SELECT_ID, placeholder: '1. Catégorie de logs' })
export class SetupLogsCatSelect {}

@ChannelSelect({ customId: SETUP_LOGS_CHANNEL_ID, placeholder: '2. Salon des logs' })
export class SetupLogsChannelSelect {}

@ChannelSelect({ customId: SETUP_TICKETS_CATEGORY_ID, placeholder: 'Catégorie des tickets' })
export class SetupTicketsCategorySelect {}

@RoleSelect({ customId: SETUP_TICKETS_STAFF_ID, placeholder: 'Rôle staff' })
export class SetupTicketsStaffSelect {}

@ChannelSelect({ customId: SETUP_TICKETS_PANEL_ID, placeholder: 'Salon du panneau' })
export class SetupTicketsPanelSelect {}

@ChannelSelect({ customId: SETUP_TICKETS_LOGS_ID, placeholder: 'Salon des transcripts' })
export class SetupTicketsLogsSelect {}

@Button({ customId: SETUP_TICKETS_POST_ID, label: '📬 Poster le panneau', style: 'primary' })
export class SetupTicketsPost {}

@RoleSelect({ customId: SETUP_ROLES_ADD_ID, placeholder: 'Rôles proposés' })
export class SetupRolesAddSelect {}

@ChannelSelect({ customId: SETUP_ROLES_CHANNEL_ID, placeholder: 'Salon du menu de rôles' })
export class SetupRolesChannelSelect {}

@Button({ customId: SETUP_ROLES_POST_ID, label: '📬 Poster le menu', style: 'primary' })
export class SetupRolesPost {}

@Button({ customId: SETUP_ROLES_REFRESH_ID, label: '🔄 Rafraîchir le menu', style: 'secondary' })
export class SetupRolesRefresh {}

@Button({ customId: SETUP_LEVELS_TOGGLE_ID, label: '🏆 Levels on/off', style: 'primary' })
export class SetupLevelsToggle {}

@ChannelSelect({ customId: SETUP_LEVELS_CHANNEL_ID, placeholder: 'Salon des level-ups' })
export class SetupLevelsChannelSelect {}

@ChannelSelect({ customId: SETUP_MOD_CHANNEL_ID, placeholder: 'Salon réservé aux sanctions' })
export class SetupModChannelSelect {}

@Button({ customId: SETUP_MOD_DERANK_ID, label: '⚖️ Mute derank on/off', style: 'primary' })
export class SetupModDerank {}

@StringSelect({ customId: SETUP_CONFIG_KEY_SELECT_ID, placeholder: 'Choisis une clé de configuration' })
export class SetupConfigKeySelect {}

@StringSelect({ customId: SETUP_LANGUAGE_SELECT_ID, placeholder: 'Langue par défaut du serveur' })
export class SetupLanguageSelect {}

@Button({ customId: SETUP_ASSISTANT_CLEAR_ID, label: '🌐 Utiliser le salon dédié IA', style: 'secondary' })
export class SetupAssistantClear {}

import { ModalComponent, ModalInput } from '@spraxium/components';

/** Modale de saisie de la valeur pour la clé sélectionnée en config avancée. */
@ModalComponent({ id: 'setup-config-value', title: 'Nouvelle valeur' })
export class SetupConfigValueModal {
  @ModalInput({ label: 'Valeur', style: 'paragraph', placeholder: 'true/false, nombre, <#salon>, texte', required: true })
  value!: string;
}

@Button({ customId: 'setup:panel-button', label: 'Panneau de configuration', style: 'primary' })
export class SetupPanelButton {}
