import { HttpBody, HttpController, HttpCtx, HttpDelete, HttpGet, HttpGuards, HttpParam, HttpPost, HttpPut } from '@spraxium/http';
import type { Context } from 'hono';
import { IntegrationUpdateSchema, type IntegrationTestResult, type IntegrationView } from '@10cordes/shared';
import { GuildAccessGuard, guildAccessOf } from '../../auth/guards/guild-access.guard';
import { SessionGuard } from '../../auth/guards/session.guard';
import { GuildIntegrationService } from '../integrations/guild-integration.service';
import type { IntegrationDef } from '../integrations/integration.service';
import { domainToHttpError } from './domain-errors';
import { notFoundHere, parseBody } from './http-errors';
import {
  SERVICE_INTEGRATIONS,
  assertInstanceKeyStaysHome,
  assertIntegrationBaseUrl,
  integrationUpdateToFields,
  integrationView,
  serviceIntegrationOf,
  testIntegrationAccess,
} from './integrations.support';

/**
 * Intégrations de SERVICE d'un serveur (PixelLab...) : `/api/v1/guilds/:guildId/integrations`.
 * Ce ne sont jamais des fournisseurs de modèles IA (une autre API) : chacun a
 * ses propres outils, et la clé vient du serveur ou de l'instance. La clé elle-même
 * ne paraît jamais dans une réponse, seulement sa présence et son extrait.
 */
@HttpController('/api/v1/guilds')
export class IntegrationsController {
  constructor(private readonly integrations: GuildIntegrationService) {}

  /** Les intégrations de service du catalogue, telles que ce serveur les utilise. */
  @HttpGet('/:guildId/integrations')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async list(@HttpCtx() ctx: Context): Promise<{ integrations: IntegrationView[] }> {
    const { guildId } = guildAccessOf(ctx);
    try {
      const integrations = await Promise.all(
        SERVICE_INTEGRATIONS.map(async (def) => integrationView(def, await this.integrations.resolve(guildId, def.id))),
      );
      return { integrations };
    } catch (error) {
      throw domainToHttpError(error);
    }
  }

  /**
   * Réglage du serveur pour une intégration. Clé absente ou vide : conservée ;
   * `null` : retirée (le serveur revient à la clé de l'instance).
   */
  @HttpPut('/:guildId/integrations/:slug')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async update(
    @HttpParam('slug') slug: string,
    @HttpCtx() ctx: Context,
    @HttpBody() body: unknown,
  ): Promise<{ integration: IntegrationView }> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const def = this.definition(slug);
    const fields = integrationUpdateToFields(parseBody(IntegrationUpdateSchema, body));
    try {
      if (fields.baseUrl) await assertIntegrationBaseUrl(fields.baseUrl);
      assertInstanceKeyStaysHome(await this.integrations.owned(guildId, def.id), fields);
      await this.integrations.upsert(guildId, def.id, fields, discordUserId, 'api');
      return { integration: integrationView(def, await this.integrations.resolve(guildId, def.id)) };
    } catch (error) {
      throw domainToHttpError(error);
    }
  }

  /** Test d'accès réel. Sans clé, le test répond son constat (200) : ce n'est pas une erreur de transport. */
  @HttpPost('/:guildId/integrations/:slug/test')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async test(@HttpParam('slug') slug: string, @HttpCtx() ctx: Context): Promise<IntegrationTestResult> {
    const { guildId } = guildAccessOf(ctx);
    const def = this.definition(slug);
    const resolved = await this.integrations.resolve(guildId, def.id);
    if (!resolved.enabled) return { ok: false, summary: 'Intégration désactivée sur ce serveur : active-la pour la tester.', status: null, ms: 0 };
    if (!resolved.config.apiKey) {
      return { ok: false, summary: `Aucune clé pour ${def.label} : saisis une clé propre au serveur, ou règle celle de l\u0027instance.`, status: null, ms: 0 };
    }
    return testIntegrationAccess(def.id, { apiKey: resolved.config.apiKey, baseUrl: resolved.config.baseUrl ?? null });
  }

  /** Retrait du réglage du serveur : l'intégration suit de nouveau l'instance. */
  @HttpDelete('/:guildId/integrations/:slug')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async remove(@HttpParam('slug') slug: string, @HttpCtx() ctx: Context): Promise<{ removed: boolean }> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const def = this.definition(slug);
    try {
      return { removed: await this.integrations.remove(guildId, def.id, discordUserId, 'api') };
    } catch (error) {
      throw domainToHttpError(error);
    }
  }

  /** L'intégration demandée, ou 404 : un slug inconnu et un fournisseur de modèles ont la même réponse. */
  private definition(slug: string): IntegrationDef {
    const def = serviceIntegrationOf(slug);
    if (!def) throw notFoundHere();
    return def;
  }
}
