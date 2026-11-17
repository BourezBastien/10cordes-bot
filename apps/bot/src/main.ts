import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { IntentPreset, SpraxiumFactory } from '@spraxium/core';
import { EnvValidator } from '@spraxium/env';
import { Logger } from '@spraxium/logger';
import { AppEnv } from './app.env';
import { AppModule } from './app.module';
import { ModuleEnabledGuard } from './modules/module-manager/module-enabled.guard';

async function main(): Promise<void> {
  const logger = new Logger('Main');

  // Miroir de la sortie console vers un fichier : le CLI spraxium daemonise
  // le process (--force-unlock) SANS stdio (process.stdout peut être absent),
  // donc sans ce miroir tous les logs de boot et de crash seraient perdus.
  // Jamais fatal : si le miroir échoue, on continue sur la sortie native.
  try {
    const mirrorPath = resolve(process.cwd(), 'bot-out.log');
    const mirror = createWriteStream(mirrorPath, { flags: 'a' });
    mirror.on('error', () => {});
    const wrap = (original: typeof process.stdout.write) =>
      ((...args: Parameters<typeof process.stdout.write>) => {
        try {
          mirror.write(typeof args[0] === 'string' ? args[0] : String(args[0]));
        } catch {
          /* le miroir ne doit jamais casser l'app */
        }
        try {
          return original(...args);
        } catch {
          return true;
        }
      }) as typeof process.stdout.write;
    if (typeof process.stdout?.write === 'function') process.stdout.write = wrap(process.stdout.write.bind(process.stdout));
    if (typeof process.stderr?.write === 'function') process.stderr.write = wrap(process.stderr.write.bind(process.stderr));
  } catch {
    /* miroir indisponible : tant pis, on tourne sans */
  }

  const environment = EnvValidator.validate(AppEnv);

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
