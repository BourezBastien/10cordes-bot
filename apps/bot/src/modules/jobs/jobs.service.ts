import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client } from 'discord.js';
import { PrismaService } from '../database/prisma.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { JobsExecutor } from './jobs.executor';
import { JobsScheduler } from './jobs.scheduler';
import { buildJobsTools } from './jobs.tools';

/**
 * Moteur de jobs planifiés GÉNÉRIQUES (unifie le pattern "due-date en DB +
 * timer + sweep au boot" dupliqué par polls/sanctions/vérification) :
 * - once à T (ex : rappel, suppression différée)
 * - cron (tz explicite, next-run recalculé par Croner)
 * - interval en minutes (borné : 5 min à 30 jours)
 * Tick 30s + sweep au boot + fenêtre de grâce 5 min (idempotence) :
 * la DB est la source de vérité, un restart ne perd rien.
 * Actions = le même schéma que les automatisations (sendMessage/sendDm/
 * addRole/removeRole) avec le vocabulaire de templates unifié.
 *
 * Répartition : JobsService (boot : enregistrement des tools puis démarrage
 * du moteur), JobsScheduler (tick, replanification, fenêtre de grâce),
 * JobsExecutor (exécution des actions d'un job), jobs.tools.ts (primitives
 * jobs.schedule/list/cancel/next).
 */

@Injectable()
export class JobsService implements SpraxiumOnBoot {
  private readonly log = new Logger('Jobs');
  // Collaborateurs non injectables : champs de classe, branchés dans le constructeur.
  private readonly executor: JobsExecutor;
  private readonly scheduler: JobsScheduler;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: Client,
  ) {
    this.executor = new JobsExecutor(prisma, client, this.log);
    this.scheduler = new JobsScheduler(prisma, this.executor, this.log);
  }

  onBoot(): void {
    const registry = getToolRegistry();
    const tools = buildJobsTools({ prisma: this.prisma, tick: () => this.scheduler.tick() });
    for (const tool of tools) registry.register(tool);
    this.log.info(`${tools.length} tools jobs enregistrés.`);
    this.scheduler.start();
  }
}
