import { HttpBody, HttpController, HttpCtx, HttpGet, HttpGuards, HttpPatch } from '@spraxium/http';
import type { Context } from 'hono';
import { AgentSettingsPatchSchema, type AgentSettings as AgentSettingsView, type ThinkingMode } from '@10cordes/shared';
import { GuildAccessGuard, guildAccessOf } from '../../auth/guards/guild-access.guard';
import { SessionGuard } from '../../auth/guards/session.guard';
import { AgentSettingsService } from '../guild-config/agent-settings.service';
import { domainToHttpError } from './domain-errors';
import { parseBody } from './http-errors';

/**
 * Réglages de l'agent d'un serveur : `/api/v1/guilds/:guildId/agent-settings`.
 * Le contrat ne porte que le mode de raisonnement : le fil de configuration
 * privé du service (son identifiant) ne quitte jamais le service. La lecture
 * répond `{ thinkingMode }` en direct, l'écriture `{ settings }`.
 */
@HttpController('/api/v1/guilds')
export class AgentSettingsController {
  constructor(private readonly settings: AgentSettingsService) {}

  @HttpGet('/:guildId/agent-settings')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async get(@HttpCtx() ctx: Context): Promise<{ thinkingMode: ThinkingMode }> {
    const { guildId } = guildAccessOf(ctx);
    return { thinkingMode: (await this.settings.get(guildId)).thinkingMode };
  }

  @HttpPatch('/:guildId/agent-settings')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async patch(@HttpCtx() ctx: Context, @HttpBody() body: unknown): Promise<{ settings: AgentSettingsView }> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const { thinkingMode } = parseBody(AgentSettingsPatchSchema, body);
    try {
      const updated = await this.settings.patch(guildId, { thinkingMode }, discordUserId, 'api');
      return { settings: { thinkingMode: updated.thinkingMode } };
    } catch (error) {
      throw domainToHttpError(error);
    }
  }
}
