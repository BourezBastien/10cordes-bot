import { HttpBody, HttpController, HttpCtx, HttpDelete, HttpGet, HttpGuards, HttpParam, HttpPut, ValidationError } from '@spraxium/http';
import { CapabilityBindSchema, CapabilitySchema } from '@10cordes/shared';
import type { CapabilityRouteView } from '@10cordes/shared';
import type { Context } from 'hono';
import { GuildAccessGuard, guildAccessOf } from '../../auth/guards/guild-access.guard';
import { SessionGuard } from '../../auth/guards/session.guard';
import { capabilityRouteViewsOf } from '../providers/provider-view.presenter';
import { GuildProviderService } from '../providers/provider-store.service';
import { httpHandled } from './providers.controller';
import { notFoundHere, parseBody } from './http-errors';

/** Capacité du chemin (native, ou `custom.*` bien formée) ; sinon 400 avec le champ en cause. */
function capabilityParam(raw: string): string {
  const parsed = CapabilitySchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError([{ property: 'capability', constraints: { message: parsed.error.issues[0]?.message ?? 'Capacité invalide.' } }]);
  return parsed.data;
}

/**
 * Routes de capacités d'un serveur, pour le dashboard :
 * `/api/v1/guilds/:guildId/capabilities`. Chaque route exige une session et
 * le droit de gérer le serveur ; les écritures passent par le store, qui les
 * audit (source `api`, l'utilisateur Discord de la session).
 *
 * `chat.reasoning` et `chat.ingestion` suivent `chat.default` tant qu'elles
 * partagent exactement sa cible : la vue le dit (`followsDefault`), et lier
 * le défaut rend les routes qui ont suivi (`followedBy`).
 */
@HttpController('/api/v1/guilds')
export class CapabilitiesController {
  constructor(private readonly store: GuildProviderService) {}

  /** Les capacités natives dans l'ordre de la matrice de routage (liées ou non), puis les capacités `custom.*` présentes. */
  @HttpGet('/:guildId/capabilities')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async list(@HttpCtx() ctx: Context): Promise<{ routes: CapabilityRouteView[] }> {
    return { routes: await this.views(guildAccessOf(ctx).guildId) };
  }

  /** Lie une capacité au modèle d'un fournisseur (repli et paramètres facultatifs : absents, les actuels sont conservés). */
  @HttpPut('/:guildId/capabilities/:capability')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async bind(@HttpCtx() ctx: Context, @HttpParam('capability') capability: string, @HttpBody() body: unknown): Promise<{ routes: CapabilityRouteView[]; followedBy: string[] }> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const target = capabilityParam(capability);
    const input = parseBody(CapabilityBindSchema, body);
    const { followedBy } = await httpHandled(() => this.store.bindRoute(guildId, target, input, discordUserId, 'api'));
    return { routes: await this.views(guildId), followedBy };
  }

  /** Retire la route d'une capacité, qui redevient non liée. Sans route : 404. */
  @HttpDelete('/:guildId/capabilities/:capability')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async unbind(@HttpCtx() ctx: Context, @HttpParam('capability') capability: string): Promise<{ routes: CapabilityRouteView[] }> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const removed = await this.store.removeRoute(guildId, capabilityParam(capability), discordUserId, 'api');
    if (!removed) throw notFoundHere();
    return { routes: await this.views(guildId) };
  }

  /** Routes du serveur, leurs cibles nommées par le slug de leur fournisseur. */
  private async views(guildId: string): Promise<CapabilityRouteView[]> {
    const [routes, providers] = await Promise.all([this.store.routes(guildId), this.store.slugIndex(guildId)]);
    const slugs = new Map(providers.map((provider) => [provider.id, provider.slug]));
    return capabilityRouteViewsOf(routes, (providerId) => slugs.get(providerId) ?? providerId);
  }
}
