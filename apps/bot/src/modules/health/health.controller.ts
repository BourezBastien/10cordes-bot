import { HttpController, HttpCtx, HttpGet, HttpGuards } from '@spraxium/http';
import { Client } from 'discord.js';
import type { Context } from 'hono';
import { ProbeKeyGuard } from '../../auth/guards/probe-key.guard';
import { AssistantQueue } from '../assistant/assistant.queue';
import { PrismaService } from '../database/prisma.service';
import { ShutdownService } from './shutdown.service';

/**
 * Sonde interne : le processus lui-même expose son état (DB, queue, gateway).
 * Utilisée par scripts/guardian.mjs, avec la clé API quand elle est réglée
 * (`ProbeKeyGuard`), et par le `HEALTHCHECK` de l'image Docker ; plus aucun
 * message webhook ne part dans le salon juste pour vérifier que le bot est
 * vivant.
 *
 * Le statut suit l'état, c'est lui que lit un répartiteur ou Docker : 200 quand
 * tout va bien, 503 quand un composant manque ou que l'extinction a commencé.
 */
@HttpController('')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: AssistantQueue,
    private readonly client: Client,
    private readonly shutdown: ShutdownService,
  ) {}

  @HttpGet('/healthz')
  @HttpGuards(ProbeKeyGuard)
  async health(@HttpCtx() ctx: Context) {
    const db = await this.prisma
      .$queryRaw`SELECT 1`
      .then(() => true)
      .catch(() => false);
    let queue: Awaited<ReturnType<AssistantQueue['counts']>> | null = null;
    try {
      queue = await this.queue.counts();
    } catch {
      queue = null;
    }
    // Pendant l'extinction, la sonde dit stop, même si tout tient encore.
    const draining = this.shutdown.isDraining();
    const gatewayReady = this.client.isReady();
    const ok = db && gatewayReady && !draining;
    return ctx.json(
      {
        ok,
        uptimeSec: Math.round(process.uptime()),
        gatewayReady,
        db,
        queue,
        driver: this.queue.driverName,
        draining,
      },
      ok ? 200 : 503,
    );
  }
}
