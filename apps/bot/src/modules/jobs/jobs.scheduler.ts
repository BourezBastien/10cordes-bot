import { Cron } from 'croner';
import type { Logger } from '@spraxium/logger';
import type { PrismaService } from '../database/prisma.service';
import type { JobsExecutor } from './jobs.executor';

const TICK_MS = 30_000;
const GRACE_MS = 5 * 60_000;

/**
 * Planification des jobs : tick toutes les 30 s (et au démarrage), jobs dus
 * confiés à JobsExecutor, récurrents replanifiés. La DB est la source de
 * vérité, un restart ne perd rien.
 * Collaborateur non injectable : instancié par JobsService, qui lui fournit
 * Prisma, l'exécuteur et son logger.
 */
export class JobsScheduler {
  private tickTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: JobsExecutor,
    private readonly log: Logger,
  ) {}

  /** Démarre le moteur : sweep immédiat (rattrapage au boot) puis tick périodique. */
  start(): void {
    this.tickTimer = setInterval(() => void this.tick(), TICK_MS);
    this.tickTimer.unref?.();
    void this.tick();
  }

  /** Un tick : exécute les jobs dus, replanifie les récurrents. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const due = await this.prisma.scheduledJob.findMany({
        where: {
          enabled: true,
          OR: [
            { kind: 'once', runAt: { lte: now } },
            { kind: 'cron', runAt: { lte: now } },
            { kind: 'interval', runAt: { lte: now } },
          ],
        },
      });
      for (const job of due) {
        // Fenêtre de grâce : un job trop vieux (crash long) ne rattrape pas
        // des dizaines d'exécutions — il saute à l'occurrence suivante.
        if (job.runAt && now.getTime() - job.runAt.getTime() > GRACE_MS) {
          await this.reschedule(job.id, job.kind, job.runAt, job.cron, job.intervalMinutes, job.tz);
          continue;
        }
        await this.executor.executeJob(job.id, job.guildId, job.name, job.actions);
        await this.reschedule(job.id, job.kind, job.runAt, job.cron, job.intervalMinutes, job.tz);
      }
    } catch (error) {
      this.log.warn(`tick échoué : ${(error as Error).message.slice(0, 120)}`);
    } finally {
      this.running = false;
    }
  }

  private async reschedule(
    jobId: string,
    kind: string,
    currentRunAt: Date | null,
    cron: string | null,
    intervalMinutes: number | null,
    tz: string,
  ): Promise<void> {
    if (kind === 'once') {
      await this.prisma.scheduledJob.update({ where: { id: jobId }, data: { enabled: false, lastRunAt: new Date() } });
      return;
    }
    let next: Date | null = null;
    if (kind === 'interval' && intervalMinutes) {
      next = new Date(Date.now() + intervalMinutes * 60_000);
    } else if (kind === 'cron' && cron) {
      try {
        const cronerJob = new Cron(cron, { timezone: tz });
        next = cronerJob.nextRun() ?? null;
        cronerJob.stop();
      } catch {
        next = null;
      }
    }
    if (!next) {
      await this.prisma.scheduledJob.update({ where: { id: jobId }, data: { enabled: false, lastRunAt: new Date() } });
      return;
    }
    await this.prisma.scheduledJob.update({ where: { id: jobId }, data: { runAt: next, lastRunAt: new Date() } });
  }
}
