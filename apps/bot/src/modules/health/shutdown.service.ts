import { Injectable, type SpraxiumOnBoot, type SpraxiumOnShutdown } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { AppEnv } from '../../app.env';
import { AssistantQueue } from '../assistant/assistant.queue';
import { DashboardEventsService } from '../api/dashboard-events.service';
import { bindShutdown } from './shutdown.runtime';

/*
 * EXTINCTION PROPRE. Sur SIGTERM ou SIGINT (docker stop, Ctrl+C), le framework
 * lance les crochets d'extinction, puis déconnecte le bot et sort. Sans rien
 * faire, une demande en cours était coupée net : sa réponse jamais envoyée,
 * son indicateur « écrit… » jamais éteint.
 *
 * Ce crochet vide d'abord, dans un délai de grâce :
 * - la sonde répond 503 (un répartiteur cesse d'envoyer du trafic) ;
 * - les flux temps réel du panel se ferment (ils ne finiraient jamais seuls,
 *   et le serveur HTTP attend ses réponses en cours) ;
 * - la file ne prend plus de demande, et attend celles en traitement ; celles
 *   en attente restent au pilote (BullMQ les garde pour le démarrage suivant) ;
 * - les travaux suivis (une conversation venue du panel) finissent.
 * La base se ferme APRÈS (PrismaService attend la vidange par l'accesseur).
 * Au-delà du délai, l'extinction suit son cours : ce qui restait est dit.
 *
 * Les crochets du framework courent en parallèle : c'est l'accesseur
 * (awaitShutdownDrained) qui ordonne « la base après la vidange ».
 */

export const DEFAULT_SHUTDOWN_GRACE_MS = 20_000;
export const SHUTDOWN_GRACE_MAX_MS = 5 * 60_000;

/** Le délai de grâce annoncé, en millisecondes et borné : une valeur illisible rend le défaut. */
export function shutdownGraceMs(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SHUTDOWN_GRACE_MS;
  return Math.min(parsed, SHUTDOWN_GRACE_MAX_MS);
}

@Injectable()
export class ShutdownService implements SpraxiumOnBoot, SpraxiumOnShutdown {
  private readonly log = new Logger('Shutdown');
  private readonly graceMs: number;
  private readonly tracked = new Set<Promise<unknown>>();
  private draining = false;
  private drainedPromise: Promise<boolean> | null = null;

  constructor(
    env: AppEnv,
    private readonly queue: AssistantQueue,
    private readonly events: DashboardEventsService,
  ) {
    this.graceMs = shutdownGraceMs(env.SHUTDOWN_GRACE_MS);
  }

  onBoot(): void {
    bindShutdown(this);
  }

  isDraining(): boolean {
    return this.draining;
  }

  /** Suit un travail en cours : l'extinction l'attend, sans en changer l'issue. */
  track<T>(work: Promise<T>): Promise<T> {
    this.tracked.add(work);
    void work.then(
      () => this.tracked.delete(work),
      () => this.tracked.delete(work),
    );
    return work;
  }

  /** Crochet du framework (SIGTERM, SIGINT) : lance la vidange, une seule fois. */
  async onShutdown(): Promise<void> {
    if (!this.drainedPromise) {
      this.draining = true;
      this.drainedPromise = this.drain();
    }
    await this.drainedPromise;
  }

  /** Attend la fin de la vidange, au plus `timeoutMs` : pour qui ferme une ressource APRÈS les demandes en cours. */
  async drained(timeoutMs: number = this.graceMs): Promise<boolean> {
    if (!this.drainedPromise) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.drainedPromise,
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs) + 1_000);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async drain(): Promise<boolean> {
    const streams = this.events.closeAll();
    const running = this.queue.activeCount();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), this.graceMs);
      });
      const work = Promise.allSettled([this.queue.close().catch(() => undefined), ...[...this.tracked]]);
      const settled = await Promise.race([work.then(() => true), timeout]);
      if (settled) this.log.info(`Extinction : demandes en cours soldées (${running} en traitement, ${streams} flux temps réel fermés).`);
      else {
        this.log.warn(
          `Extinction : délai de grâce de ${Math.round(this.graceMs / 1000)} s dépassé, ${this.queue.activeCount()} demande(s) en traitement abandonnée(s), ${this.tracked.size} travail(s) suivi(s).`,
        );
      }
      return settled;
    } finally {
      clearTimeout(timer);
    }
  }
}
