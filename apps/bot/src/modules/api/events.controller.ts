import { Logger } from '@spraxium/logger';
import { HttpCtx, HttpController, HttpGet, HttpGuards } from '@spraxium/http';
import { SSE_PING_INTERVAL_MS } from '@10cordes/shared';
import type { Context } from 'hono';
import { SSEStreamingApi } from 'hono/streaming';
import { GuildAccessGuard, guildAccessOf } from '../../auth/guards/guild-access.guard';
import { SessionGuard } from '../../auth/guards/session.guard';
// Import de VALEUR : le jeton d'injection du constructeur vient du type déclaré (import type donnerait Object).
import { DashboardEventsService } from './dashboard-events.service';

/**
 * En-têtes du flux. Posés ici, et non par l'aide `streamSSE` de Hono : elle
 * impose `Cache-Control: no-cache`, le contrat du panel veut `no-store`.
 */
const STREAM_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream',
  'Transfer-Encoding': 'chunked',
  'Cache-Control': 'no-store',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'X-Robots-Tag': 'noindex, nofollow',
};

/**
 * Flux temps réel du dashboard : `GET /api/v1/guilds/:guildId/events`
 * (Server-Sent Events). Chaque événement ne porte que son type
 * (`provider.updated`, `capability.updated`...) : le dashboard invalide ses
 * requêtes et relit. Le flux est celui d'UN serveur, ouvert par quelqu'un qui
 * peut le gérer : l'activité d'un autre serveur n'y paraît jamais.
 */
@HttpController('/api/v1/guilds')
export class EventsController {
  private readonly log = new Logger('DashboardEvents');

  constructor(private readonly bus: DashboardEventsService) {}

  @HttpGet('/:guildId/events')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async events(@HttpCtx() ctx: Context): Promise<Response> {
    const { guildId } = guildAccessOf(ctx);
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const stream = new SSEStreamingApi(writable, readable);
    void this.hold(stream, guildId);
    return ctx.newResponse(stream.responseReadable, { headers: { ...STREAM_HEADERS } });
  }

  /**
   * Contenu du flux, jusqu'à ce que le client parte : un événement
   * d'ouverture, les événements du serveur, un signe de vie régulier (derrière
   * un proxy, un flux muet plus de 30 s est coupé). À la fermeture, le
   * battement s'arrête et l'abonnement se retire.
   */  private async hold(stream: SSEStreamingApi, guildId: string): Promise<void> {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      // L'ouverture est mise en file sans être attendue : son écriture ne se
      // résout que lorsque le client la lit. S'abonner ensuite, c'est prendre
      // le risque de manquer un événement survenu entre les deux.
      void stream.writeSSE({ event: 'open', data: '{}' }).catch(() => undefined);
      unsubscribe = this.bus.subscribe(guildId, (event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) }).catch(() => undefined);
      });
      heartbeat = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }).catch(() => undefined), SSE_PING_INTERVAL_MS);
      heartbeat.unref?.();
      await new Promise<void>((resolve) => stream.onAbort(resolve));
    } catch (error) {
      this.log.warn(`flux temps réel du serveur ${guildId} interrompu : ${error instanceof Error ? error.message.slice(0, 120) : 'cause inconnue'}`);
    } finally {
      clearInterval(heartbeat);
      unsubscribe?.();
      await stream.close();
    }
  }
}
