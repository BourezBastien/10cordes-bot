import { HttpBody, HttpController, HttpCtx, HttpGet, HttpGuards, HttpPatch } from '@spraxium/http';
import type { Context } from 'hono';
import { GuildRulesPatchSchema, type GuildRules as GuildRulesView } from '@10cordes/shared';
import { GuildAccessGuard, guildAccessOf } from '../../auth/guards/guild-access.guard';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildRulesService } from '../rules/guild-rules.service';
import { domainToHttpError } from './domain-errors';
import { parseBody } from './http-errors';

/**
 * Règles d'un serveur : `/api/v1/guilds/:guildId/rules`. Les mêmes que celles de
 * l'outil `rules.set` (en vigueur dans la gate, le registry et le prompt), par
 * le même chemin de fusion ; chaque identifiant de salon ou de catégorie est
 * validé par le contrat avant d'atteindre le service.
 */
@HttpController('/api/v1/guilds')
export class RulesController {
  constructor(private readonly rules: GuildRulesService) {}

  /** Les règles en vigueur, en objet direct (le patch, lui, répond `{ rules }`). */
  @HttpGet('/:guildId/rules')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async get(@HttpCtx() ctx: Context): Promise<GuildRulesView> {
    const { guildId } = guildAccessOf(ctx);
    return this.rules.get(guildId);
  }

  /** Patch partiel : seuls les champs fournis changent ; les instructions libres s'ajoutent et se retirent par listes. */
  @HttpPatch('/:guildId/rules')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async patch(@HttpCtx() ctx: Context, @HttpBody() body: unknown): Promise<{ rules: GuildRulesView }> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const patch = parseBody(GuildRulesPatchSchema, body);
    try {
      return { rules: await this.rules.apply(guildId, patch, discordUserId, 'api') };
    } catch (error) {
      throw domainToHttpError(error);
    }
  }
}
