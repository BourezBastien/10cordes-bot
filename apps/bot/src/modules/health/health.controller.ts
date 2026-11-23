import { HttpController, HttpGet } from '@spraxium/http';
import { Client } from 'discord.js';
import { AssistantQueue } from '../assistant/assistant.queue';
import { PrismaService } from '../database/prisma.service';

/**
 * Sonde interne : le processus lui-même expose son état (DB, queue, gateway).
 * Utilisée par scripts/guardian.mjs — plus aucun message webhook ne part dans
 * le salon juste pour vérifier que le bot est vivant.
 */
@HttpController('')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: AssistantQueue,
    private readonly client: Client,
  ) {}

  @HttpGet('/healthz')
  async health() {
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
    return {
      ok: db && this.client.isReady(),
      uptimeSec: Math.round(process.uptime()),
      gatewayReady: this.client.isReady(),
      db,
      queue,
      driver: this.queue.driverName,
    };
  }
}
