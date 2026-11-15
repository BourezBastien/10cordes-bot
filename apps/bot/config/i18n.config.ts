import { defineI18n } from '@spraxium/i18n';

// name vide : les clés s'enregistrent à plat ("setup.title") — un nom de
// référence non vide sert de préfixe ("bot.setup.title") et casserait t().
export const i18nConfig = defineI18n({
  defaultLocale: 'fr',
  references: [{ name: '', path: './src/i18n/bot' }],
});
