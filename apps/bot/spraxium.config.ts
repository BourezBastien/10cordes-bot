import { defineConfig } from '@spraxium/core';
import { defineComponents } from '@spraxium/components';
import { defineI18n } from '@spraxium/i18n';
import { developmentConfig } from './config/development.config';
import { httpConfig } from './config/http.config';
import { i18nConfig } from './config/i18n.config';

export const componentsConfig = defineComponents({});

export default defineConfig((env) => ({
  debug: env.isNeutral,
  plugins: [httpConfig, i18nConfig, componentsConfig],
  dev: developmentConfig,
}));
