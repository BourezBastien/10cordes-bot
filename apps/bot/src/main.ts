import { IntentPreset, SpraxiumFactory } from '@spraxium/core';
import { EnvValidator } from '@spraxium/env';
import { I18nStoreRegistry } from '@spraxium/i18n';
import { Logger } from '@spraxium/logger';
import { AppEnv } from './app.env';
import { AppModule } from './app.module';
import { PrismaI18nStore } from './i18n/store';
import { ModuleEnabledGuard } from './modules/module-manager/module-enabled.guard';

async function main(): Promise<void> {
  const logger = new Logger('Main');
  const environment = EnvValidator.validate(AppEnv);

  // Store i18n persisté (langue par utilisateur) — doit être enregistré avant le create.
  I18nStoreRegistry.set(new PrismaI18nStore());

  const app = await SpraxiumFactory.create({ token: environment.token });

  app.useModule(AppModule);
  app.provide(AppEnv, environment);
  app.useGlobalGuards(ModuleEnabledGuard);
  // MessageContent : requis pour l'historique des conversations de l'assistant IA
  // (intent privileged, à activer aussi dans le portail développeur Discord).
  app.intents(IntentPreset.WithMessageContent);

  logger.info('Starting application...');
  await app.listen();
}

main();
