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

  // Promesses rejetées sans catch (ex: écritures audit void) : visibles en console.
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason)}`);
  });

  // Exceptions synchrones non capturées : sans ce handler, Node tue le process
  // sans trace utile dans le log (mort silencieuse observée le 16/11/2026).
  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error?.stack ?? String(error)}`);
  });

  // Qui appelle process.exit ? Les morts silencieuses (exit 1 sans trace) de
  // 2026-11-16 demandent l'appelant exact.
  const originalExit = process.exit.bind(process);
  process.exit = ((code?: number) => {
    logger.error(`process.exit(${code ?? 0}) appelé\n${new Error('exit caller').stack}`);
    return originalExit(code);
  }) as typeof process.exit;

  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGBREAK'] as const) {
    process.on(signal, () => {
      logger.error(`Signal ${signal} reçu\n${new Error('signal caller').stack}`);
    });
  }

  logger.info('Starting application...');
  await app.listen();
}

main();
