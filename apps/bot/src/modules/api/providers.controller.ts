import { ConflictError, HttpBody, HttpController, HttpCtx, HttpDelete, HttpError, HttpGet, HttpGuards, HttpParam, HttpPatch, HttpPost, UnprocessableEntityError } from '@spraxium/http';
import { ProviderCreateSchema, ProviderModelAddSchema, ProviderUpdateSchema } from '@10cordes/shared';
import type { ProviderModel, ProviderTestResult, ProviderView } from '@10cordes/shared';
import type { Context } from 'hono';
import { ZodError } from 'zod';
import { GuildAccessGuard, guildAccessOf } from '../../auth/guards/guild-access.guard';
import { SessionGuard } from '../../auth/guards/session.guard';
import { AuditService } from '../audit/audit.service';
import { failureSummary, redactSecret } from '../providers/adapters/generic-http.errors';
import { slugForProvider, uniqueSlug } from '../providers/handlers/provider-hub.slug';
import { InMemoryModelCooldownStore } from '../providers/model-cooldown.store';
import { ProviderAdapterRegistry } from '../providers/provider-adapter.registry';
import { providerCreateInput, providerUpdateInput } from '../providers/provider-input.mapper';
import { ProviderHealthService } from '../providers/provider-health.service';
import { probeConnection, type ConnectionProbe } from '../providers/provider-probe';
import { GuildProviderService } from '../providers/provider-store.service';
import { providerModelViewOf, providerViewOf } from '../providers/provider-view.presenter';
import { ProviderError, type ProviderConfig } from '../providers/provider.types';
import { notFoundHere, parseBody, toHttpError } from './http-errors';

/** Bornes du contrat pour le résultat d'un contrôle. */
const SUMMARY_MAX = 600;

/**
 * Erreur d'une route en statut HTTP juste : celle du contrat (400 avec le
 * champ en cause) ou du domaine (refus nommé) est traduite. Toute autre
 * (base, bug) reste ce qu'elle est : le framework la journalise et répond 500.
 */
export function httpErrorOf(error: unknown): never {
  if (error instanceof HttpError || error instanceof ZodError || error instanceof ProviderError) throw toHttpError(error);
  throw error;
}

/** Corps d'une route : un refus du contrat ou du domaine devient un statut HTTP juste, le reste reste une erreur du serveur. */
export async function httpHandled<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw httpErrorOf(error);
  }
}

/**
 * Fournisseurs IA d'un serveur, pour le dashboard :
 * `/api/v1/guilds/:guildId/providers`. Chaque route exige une session et le
 * droit de gérer le serveur. Une réponse ne montre jamais une clé : seulement
 * qu'elle existe, et son indice. Les écritures passent par le store, qui les
 * audit (source `api`, l'utilisateur Discord de la session).
 */
@HttpController('/api/v1/guilds')
export class ProvidersController {
  constructor(
    private readonly store: GuildProviderService,
    private readonly registry: ProviderAdapterRegistry,
    private readonly health: ProviderHealthService,
    private readonly audit: AuditService,
    private readonly cooldowns: InMemoryModelCooldownStore,
  ) {}

  /** Fournisseurs du serveur, avec leur santé. */
  @HttpGet('/:guildId/providers')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async list(@HttpCtx() ctx: Context): Promise<{ providers: ProviderView[] }> {
    const { guildId } = guildAccessOf(ctx);
    const providers = await this.store.list(guildId);
    return { providers: providers.map((provider) => this.viewOf(guildId, provider)) };
  }

  /** Connecte un fournisseur : le slug du corps, sinon un slug déduit du nom et libre sur le serveur. Un slug déjà pris : 409, la création ne modifie jamais un fournisseur existant. */
  @HttpPost('/:guildId/providers')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async create(@HttpCtx() ctx: Context, @HttpBody() body: unknown): Promise<{ provider: ProviderView }> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const input = parseBody(ProviderCreateSchema, body);
    const provider = await httpHandled(async () => {
      const taken = new Set((await this.store.slugIndex(guildId)).map((known) => known.slug));
      if (input.slug !== undefined && taken.has(input.slug)) throw new ConflictError(`Slug « ${input.slug} » déjà pris sur ce serveur.`);
      return this.store.upsert(guildId, providerCreateInput(input, input.slug ?? uniqueSlug(slugForProvider(input.displayName), taken)), discordUserId, 'api');
    });
    return { provider: this.viewOf(guildId, provider) };
  }

  /** Modifie un fournisseur. Champ absent : rien ne change. Clé absente, `undefined` ou vide : le secret est conservé ; `null` : elle est retirée. */
  @HttpPatch('/:guildId/providers/:providerId')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async update(@HttpCtx() ctx: Context, @HttpParam('providerId') providerId: string, @HttpBody() body: unknown): Promise<{ provider: ProviderView }> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const input = parseBody(ProviderUpdateSchema, body);
    const current = await this.requireProvider(guildId, providerId);
    const provider = await httpHandled(() => this.store.upsert(guildId, providerUpdateInput(input, current), discordUserId, 'api'));
    return { provider: this.viewOf(guildId, provider) };
  }

  /** Supprime un fournisseur : sa clé et ses routes partent avec lui. */
  @HttpDelete('/:guildId/providers/:providerId')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async remove(@HttpCtx() ctx: Context, @HttpParam('providerId') providerId: string): Promise<{ removed: true }> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const removed = await this.store.remove(guildId, providerId, discordUserId, 'api');
    if (!removed) throw notFoundHere();
    return { removed: true };
  }

  /**
   * Contrôle la connexion et rafraîchit le catalogue découvert (les slugs
   * saisis à la main restent). Un contrôle qui échoue est un résultat, pas
   * une erreur HTTP : il nourrit la santé du fournisseur comme un appel réel.
   */
  @HttpPost('/:guildId/providers/:providerId/test')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async test(@HttpCtx() ctx: Context, @HttpParam('providerId') providerId: string): Promise<ProviderTestResult> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const provider = await this.requireProvider(guildId, providerId);
    let probe: ConnectionProbe;
    try {
      probe = await probeConnection({ store: this.store, registry: this.registry, cooldowns: this.cooldowns }, provider);
    } catch (error) {
      // Seule une erreur de fournisseur est un contrôle qui échoue ; toute autre (base, bug) reste une erreur du serveur.
      if (!(error instanceof ProviderError)) throw error;
      probe = { ok: false, summary: failureSummary(error, provider.apiKey), modelsFound: 0, error };
    }
    this.health.record(guildId, provider.id, probe.ok ? { ok: true } : { ok: false, error: probe.error, transient: false, secret: provider.apiKey });
    this.audit.record({ guildId, source: 'api', action: 'provider.tested', actorId: discordUserId, metadata: { providerId: provider.id, slug: provider.slug, ok: probe.ok, modelsFound: probe.modelsFound } });
    return { ok: probe.ok, summary: redactSecret(probe.summary, provider.apiKey).slice(0, SUMMARY_MAX), modelsFound: probe.modelsFound, status: this.health.statusOf(guildId, provider.id) };
  }

  /** Catalogue du fournisseur : modèles découverts, et slugs saisis à la main (`origin`). */
  @HttpGet('/:guildId/providers/:providerId/models')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async models(@HttpCtx() ctx: Context, @HttpParam('providerId') providerId: string): Promise<{ models: ProviderModel[] }> {
    const provider = await this.requireProvider(guildAccessOf(ctx).guildId, providerId);
    return { models: provider.models.map(providerModelViewOf) };
  }

  /** Ajoute un slug de modèle saisi à la main (idempotent : déjà au catalogue, rien ne change). */
  @HttpPost('/:guildId/providers/:providerId/models')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async addModel(@HttpCtx() ctx: Context, @HttpParam('providerId') providerId: string, @HttpBody() body: unknown): Promise<{ models: ProviderModel[] }> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const input = parseBody(ProviderModelAddSchema, body);
    const provider = await this.requireProvider(guildId, providerId);
    const models = await httpHandled(() => this.store.catalog.addManual(guildId, provider.id, input.modelId, discordUserId, 'api'));
    return { models: models.map(providerModelViewOf) };
  }

  /** Retire un slug saisi à la main. Un modèle que le fournisseur liste ne se retire pas : 422, et rien ne change. */
  @HttpDelete('/:guildId/providers/:providerId/models/:modelId')
  @HttpGuards(SessionGuard, GuildAccessGuard)
  async removeModel(@HttpCtx() ctx: Context, @HttpParam('providerId') providerId: string, @HttpParam('modelId') modelId: string): Promise<{ models: ProviderModel[] }> {
    const { guildId, discordUserId } = guildAccessOf(ctx);
    const provider = await this.requireProvider(guildId, providerId);
    const { outcome, models } = await httpHandled(() => this.store.catalog.removeManual(guildId, provider.id, modelId, discordUserId, 'api'));
    if (outcome === 'missing') throw notFoundHere();
    if (outcome !== 'removed') throw new UnprocessableEntityError('Ce modèle vient du catalogue du fournisseur : il ne se retire pas à la main.');
    return { models: models.map(providerModelViewOf) };
  }

  /** Fournisseur de CE serveur, par identifiant ou par slug ; sinon 404. */
  private async requireProvider(guildId: string, providerId: string): Promise<ProviderConfig> {
    const provider = await this.store.get(guildId, providerId);
    if (!provider) throw notFoundHere();
    return provider;
  }

  private viewOf(guildId: string, provider: ProviderConfig): ProviderView {
    return providerViewOf(provider, this.health.statusOf(guildId, provider.id));
  }
}
