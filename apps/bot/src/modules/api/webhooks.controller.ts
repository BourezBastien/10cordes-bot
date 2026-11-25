import {
  ConflictError,
  HttpBody,
  HttpCtx,
  HttpController,
  HttpDelete,
  HttpGet,
  HttpGuards,
  HttpParam,
  HttpPatch,
  HttpPost,
  UnprocessableEntityError,
} from '@spraxium/http';
import { WebhookCreateSchema, WebhookUpdateSchema } from '@10cordes/shared';
import type { Context } from 'hono';
import { ZodError } from 'zod';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildAccessGuard, guildAccessOf } from '../../auth/guards/guild-access.guard';
import { ProviderError } from '../providers/provider.types';
import { WebhookEndpointError } from '../webhooks/webhook-endpoint.errors';
import { WebhookEndpointService } from '../webhooks/webhook-endpoint.service';
import { notFoundHere, parseBody, toHttpError } from './http-errors';

/**
 * Erreur du domaine en erreur HTTP. Un refus typé du connecteur devient 422
 * (409 pour un slug pris, 422 pour le quota) ; une erreur de fournisseur ou
 * une erreur Zod prennent le statut que `toHttpError` leur donne. Tout le
 * reste remonte tel quel : le framework le journalise et répond 500, sans
 * détail vers le client.
 */
function toHttpFailure(error: unknown): unknown {
  if (error instanceof WebhookEndpointError) {
    return error.kind === 'conflict' ? new ConflictError(error.message) : new UnprocessableEntityError(error.message);
  }
  if (error instanceof ProviderError || error instanceof ZodError) return toHttpError(error);
  return error;
}

/**
 * Connecteurs HTTP sortants du tableau de bord :
 * `/api/v1/guilds/:guildId/webhooks`. Lecture et écriture réservées à un
 * membre qui gère le serveur (`SessionGuard` puis `GuildAccessGuard`, sur
 * chaque route).
 *
 * Les réponses ne montrent jamais la valeur d'un en-tête secret : ses noms
 * seulement. Un identifiant qui existe sur un AUTRE serveur répond 404, comme
 * un identifiant inconnu : rien ne révèle ce qui existe ailleurs.
 */
@HttpController('/api/v1/guilds')
export class WebhooksController {
  constructor(private readonly webhooks: WebhookEndpointService) {}

  /** Connecteurs du serveur, du plus ancien au plus récent. */
  @HttpGet('/:guildId/webhooks')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async list(@HttpCtx() ctx: Context): Promise<unknown> {
    const { guildId } = guildAccessOf(ctx);
    return { webhooks: await this.webhooks.list(guildId) };
  }

  /** Crée un connecteur. Corps validé par le contrat (400), refus du domaine en 422 ou 409. */
  @HttpPost('/:guildId/webhooks')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async create(@HttpCtx() ctx: Context, @HttpBody() body: unknown): Promise<unknown> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const input = parseBody(WebhookCreateSchema, body);
    const webhook = await this.settle(() => this.webhooks.create(guildId, input, discordUserId, 'api'));
    return { webhook };
  }

  /** Change un connecteur. Un champ absent du corps ne bouge pas, les en-têtes secrets compris. */
  @HttpPatch('/:guildId/webhooks/:webhookId')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async update(@HttpCtx() ctx: Context, @HttpParam('webhookId') webhookId: string, @HttpBody() body: unknown): Promise<unknown> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const input = parseBody(WebhookUpdateSchema, body);
    const webhook = await this.settle(() => this.webhooks.update(guildId, webhookId, input, discordUserId, 'api'));
    if (!webhook) throw notFoundHere();
    return { webhook };
  }

  /** Supprime un connecteur. */
  @HttpDelete('/:guildId/webhooks/:webhookId')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async remove(@HttpCtx() ctx: Context, @HttpParam('webhookId') webhookId: string): Promise<unknown> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const removed = await this.settle(() => this.webhooks.remove(guildId, webhookId, discordUserId, 'api'));
    if (!removed) throw notFoundHere();
    return { removed: true };
  }

  /** Essai d'un connecteur : une requête part avec `{ ping: true, at }`, le statut est consigné. */
  @HttpPost('/:guildId/webhooks/:webhookId/ping')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async ping(@HttpCtx() ctx: Context, @HttpParam('webhookId') webhookId: string): Promise<unknown> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const result = await this.settle(() => this.webhooks.ping(guildId, webhookId, discordUserId, 'api'));
    if (!result) throw notFoundHere();
    return result;
  }

  /** Exécute une opération du domaine en traduisant ses erreurs typées en statut HTTP. */
  private async settle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toHttpFailure(error);
    }
  }
}
