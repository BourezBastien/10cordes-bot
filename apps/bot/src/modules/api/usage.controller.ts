import { BadRequestError, HttpCtx, HttpController, HttpGet, HttpGuards, HttpQuery } from '@spraxium/http';
import type { Context } from 'hono';
import { USAGE_WINDOWS, UsageWindowSchema, type UsageSummary } from '@10cordes/shared';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildAccessGuard, guildAccessOf } from '../../auth/guards/guild-access.guard';
import { UsageReaderService } from '../usage/usage-reader.service';

/** Fenêtre lue quand la requête n'en précise pas. */
const DEFAULT_WINDOW = '24h';

/**
 * Jetons consommés par l'agent d'un serveur : `GET /api/v1/guilds/:guildId/usage?window=24h`
 * (page Système). Fenêtres acceptées : 24 h (défaut), 7 jours ou 30 jours ;
 * toute autre vaut 400. Le serveur compté est celui de la route, celui que la
 * garde d'accès vient de vérifier pour le membre connecté.
 *
 * Le handler ne s'appelle pas comme une propriété du contrôleur : le routeur
 * cherche la méthode par son nom sur l'instance, et une propriété de constructeur
 * la masquerait (route absente, 404 muet).
 */
@HttpController('/api/v1/guilds')
export class UsageController {
  constructor(private readonly usage: UsageReaderService) {}

  @HttpGet('/:guildId/usage')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async summary(@HttpCtx() ctx: Context, @HttpQuery('window') window?: string): Promise<UsageSummary> {
    const { guildId } = guildAccessOf(ctx);
    const parsed = UsageWindowSchema.safeParse(window ?? DEFAULT_WINDOW);
    if (!parsed.success) throw new BadRequestError(`Fenêtre d\u0027usage inconnue : attendue l\u0027une de ${USAGE_WINDOWS.join(', ')}.`);
    return this.usage.summary(guildId, parsed.data);
  }
}
