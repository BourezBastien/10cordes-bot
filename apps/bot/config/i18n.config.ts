import { defineI18n } from '@spraxium/i18n';

export const i18nConfig = defineI18n({
  defaultLocale: 'fr',
  references: [{ name: 'bot', path: './src/i18n/bot' }],
});
