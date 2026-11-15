import { defineConfig } from '@spraxium/core';
import { defineComponents } from '@spraxium/components';
import { defineI18n } from '@spraxium/i18n';
import { developmentConfig } from './config/development.config';
import { httpConfig } from './config/http.config';
import { i18nConfig } from './config/i18n.config';
import { componentsConfig } from './config/components.config';
import { GuildErrorLayout } from './src/modules/guild-config/guild-error.layout';

export default defineConfig((env) => ({
  debug: env.isNeutral,
  plugins: [httpConfig, i18nConfig, componentsConfig],
  exceptions: {
    logUnhandled: true,
    layouts: { default: GuildErrorLayout },
  },
  dev: developmentConfig,
}));
