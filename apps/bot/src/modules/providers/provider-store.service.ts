import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { AppEnv } from '../../app.env';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { encryptSecret } from '../../shared/crypto/secret-box';
import { bindProvidersRuntime } from './providers.runtime';
import { PROVIDER_AUTH_TYPES, PROVIDER_PROTOCOLS, ProviderError, isCapability, type Capability, type ProviderAuthType, type ProviderConfig, type ProviderModel, type ProviderProtocol } from './provider.types';
import { assertProviderUrl } from './provider-http';
import { CONVERSATION_FOLLOWERS, CONVERSATION_LINK_HEAD, sameTarget, type RouteTarget } from './provider-route.links';
import { assertModelServes } from './provider-model.kinds';
import { MODEL_ID_MAX, boundedModels, providerFromRow, providerSecrets } from './provider-store.codec';
import { hasKeys, parseModels, parseRecord, reservedKeys } from './provider-store.json';

/**
 * Fournisseurs et routes d'un serveur (tables guild_providers et
 * capability_routes). Détient le chiffrement : la clé n'est déchiffrée que
 * pour le routeur, et jamais réexportée. Les validations refusent tôt, avec
 * un message actionnable.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const ROUTES_CACHE_TTL_MS = 30_000;

export interface ProviderInput {
  slug: string;
  displayName?: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  /** Nouvelle clé en clair (chiffrée à l'écriture). Absente : la clé actuelle est conservée. */
  apiKey?: string | null;
  authType?: ProviderAuthType;
  authHeaderName?: string | null;
  customHeaders?: Record<string, string>;
  extraConfig?: Record<string, unknown>;
  enabled?: boolean;
}

export interface RouteInput {
  providerId: string;
  modelId: string;
  fallbackProviderId?: string | null;
  fallbackModelId?: string | null;
  params?: Record<string, unknown>;
  enabled?: boolean;
}

/** Une route telle que le routeur la consomme (fournisseur de repli résolu). */
export interface ResolvedRoute {
  capability: Capability;
  provider: ProviderConfig;
  modelId: string;
  fallback: { provider: ProviderConfig; modelId: string } | null;
  params: Record<string, unknown>;
}

@Injectable()
export class GuildProviderService implements SpraxiumOnBoot {
  private readonly routesCache = new Map<string, { at: number; routes: Promise<ResolvedRoute[]> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly env: AppEnv,
  ) {}

  /** Accesseur runtime pour les modules chargés avant celui-ci (panneau de configuration). */
  onBoot(): void {
    bindProvidersRuntime({ store: this });
  }

  async list(guildId: string): Promise<ProviderConfig[]> {
    const rows = await this.prisma.guildProvider.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } });
    return rows.map((row) => providerFromRow(row, providerSecrets(this.env)));
  }

  /** Fournisseurs dont les options contiennent `mark` (fragment JSON exact d'une origine de création), tous serveurs confondus. */
  async listMarked(mark: string): Promise<ProviderConfig[]> {
    const rows = await this.prisma.guildProvider.findMany({ where: { extraConfigJson: { contains: mark } } });
    return rows.map((row) => providerFromRow(row, providerSecrets(this.env)));
  }

  async get(guildId: string, idOrSlug: string): Promise<ProviderConfig | null> {
    const row = await this.prisma.guildProvider.findFirst({ where: { guildId, OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
    return row ? providerFromRow(row, providerSecrets(this.env)) : null;
  }

  async upsert(guildId: string, input: ProviderInput, actorId: string): Promise<ProviderConfig> {
    const slug = input.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) throw new ProviderError('Slug invalide : lettres minuscules, chiffres et tirets (2 à 48 caractères).', 'invalid');
    if (!(PROVIDER_PROTOCOLS as readonly string[]).includes(input.protocol)) throw new ProviderError(`Protocole inconnu : ${input.protocol}.`, 'invalid');
    const authType = input.authType ?? 'bearer';
    if (!(PROVIDER_AUTH_TYPES as readonly string[]).includes(authType)) throw new ProviderError(`Type d\u0027authentification inconnu : ${authType}.`, 'invalid');
    const baseUrl = assertProviderUrl(input.baseUrl);
    const existing = await this.prisma.guildProvider.findUnique({ where: { guildId_slug: { guildId, slug } } });
    // Pas de nouvelle clé : l'actuelle est conservée (une chaîne vide l'efface).
    const apiKey = input.apiKey === undefined ? (existing?.encryptedApiKey ?? null) : input.apiKey ? encryptSecret(input.apiKey, providerSecrets(this.env)) : null;
    // Options et en-têtes absents ou vides : les actuels sont conservés. Les clés
    // réservées (`_source`, `_model`) marquent l'origine du fournisseur et ne se perdent pas.
    const headersJson = hasKeys(input.customHeaders) ? JSON.stringify(input.customHeaders) : undefined;
    const extraJson = hasKeys(input.extraConfig)
      ? JSON.stringify({ ...reservedKeys(parseRecord(existing?.extraConfigJson ?? null)), ...input.extraConfig })
      : undefined;
    const row = await this.prisma.guildProvider.upsert({
      where: { guildId_slug: { guildId, slug } },
      create: {
        guildId,
        slug,
        displayName: (input.displayName ?? slug).trim().slice(0, 80) || slug,
        protocol: input.protocol,
        baseUrl,
        authType,
        authHeaderName: authType === 'header' || authType === 'query' ? (input.authHeaderName ?? null) : null,
        encryptedApiKey: apiKey,
        customHeadersJson: headersJson ?? null,
        extraConfigJson: extraJson ?? null,
        enabled: input.enabled ?? true,
      },
      update: {
        displayName: input.displayName !== undefined ? (input.displayName ?? slug).trim().slice(0, 80) || slug : undefined,
        protocol: input.protocol,
        baseUrl,
        authType,
        authHeaderName: authType === 'header' || authType === 'query' ? (input.authHeaderName ?? null) : null,
        encryptedApiKey: apiKey,
        customHeadersJson: headersJson,
        extraConfigJson: extraJson,
        enabled: input.enabled ?? undefined,
      },
    });
    this.audit.record({
      guildId,
      source: 'agent',
      action: 'provider.upserted',
      actorId,
      metadata: { providerId: row.id, slug: row.slug, protocol: row.protocol, host: new URL(baseUrl).host, keyChanged: input.apiKey !== undefined, enabled: row.enabled },
    });
    this.invalidate(guildId);
    return providerFromRow(row, providerSecrets(this.env));
  }

  async remove(guildId: string, idOrSlug: string, actorId: string): Promise<boolean> {
    const row = await this.prisma.guildProvider.findFirst({ where: { guildId, OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
    if (!row) return false;
    await this.prisma.guildProvider.delete({ where: { id: row.id } });
    this.audit.record({ guildId, source: 'agent', action: 'provider.removed', actorId, metadata: { providerId: row.id, slug: row.slug } });
    this.invalidate(guildId);
    return true;
  }

  /** Renomme un fournisseur : même ligne, même identifiant, ses routes sont conservées. */
  async rename(guildId: string, providerId: string, slug: string, actorId = 'system'): Promise<boolean> {
    const row = await this.prisma.guildProvider.findFirst({ where: { guildId, id: providerId } });
    if (!row) return false;
    if (row.slug === slug) return true;
    const taken = await this.prisma.guildProvider.findUnique({ where: { guildId_slug: { guildId, slug } } });
    if (taken) throw new ProviderError(`Slug « ${slug} » déjà pris sur ce serveur.`, 'invalid');
    await this.prisma.guildProvider.update({ where: { id: row.id }, data: { slug: slug.trim().toLowerCase() } });
    this.audit.record({ guildId, source: 'agent', action: 'provider.renamed', actorId, metadata: { providerId: row.id, from: row.slug, to: slug } });
    this.invalidate(guildId);
    return true;
  }

  /** Retient le catalogue découvert (ou saisi) d'un fournisseur. */
  async saveModels(guildId: string, providerId: string, models: ProviderModel[]): Promise<void> {
    await this.prisma.guildProvider.update({ where: { id: providerId }, data: { cachedModelsJson: JSON.stringify(boundedModels(models)) } });
    this.invalidate(guildId);
  }

  /**
   * Lie une capacité à un modèle. Rend les capacités qui ont suivi ce
   * changement (voir CONVERSATION_FOLLOWERS : les routes de conversation
   * qui partageaient exactement la cible précédente).
   */
  async bindRoute(guildId: string, capability: string, input: RouteInput, actorId: string): Promise<{ followedBy: string[] }> {
    if (!isCapability(capability)) throw new ProviderError(`Capacité invalide : ${capability} (native ou custom.*, en kebab-case).`, 'invalid');
    const provider = await this.prisma.guildProvider.findFirst({ where: { guildId, id: input.providerId } });
    if (!provider) throw new ProviderError('Fournisseur introuvable sur ce serveur.', 'invalid');
    const modelId = input.modelId.trim().slice(0, MODEL_ID_MAX);
    if (!modelId) throw new ProviderError('Identifiant de modèle requis.', 'invalid');
    // Un modèle du catalogue qui déclare ne pas servir cette capacité : refus, et les modèles qui la servent sont nommés.
    assertModelServes(parseModels(provider.cachedModelsJson), modelId, capability, provider.slug);
    // Non précisés (absents), le repli et les paramètres actuels de la route sont conservés ; un repli à `null` est retiré.
    const existing = await this.prisma.capabilityRoute.findUnique({ where: { guildId_capability: { guildId, capability } } });
    const fallbackProviderId = await this.fallbackId(guildId, input, existing);
    const fallbackModelId = fallbackProviderId ? input.fallbackModelId?.trim().slice(0, MODEL_ID_MAX) || existing?.fallbackModelId || modelId : null;
    const paramsJson = input.params ? JSON.stringify(input.params) : existing?.paramsJson ?? null;
    const target = { providerId: provider.id, modelId, fallbackProviderId, fallbackModelId, paramsJson };
    await this.prisma.capabilityRoute.upsert({
      where: { guildId_capability: { guildId, capability } },
      create: { guildId, capability, ...target, enabled: input.enabled ?? true },
      update: { ...target, enabled: input.enabled ?? true },
    });
    const followedBy = capability === CONVERSATION_LINK_HEAD ? await this.moveFollowers(guildId, existing, target) : [];
    this.invalidate(guildId);
    this.audit.record({
      guildId,
      source: 'agent',
      action: 'capability.bound',
      actorId,
      metadata: { capability, providerId: provider.id, slug: provider.slug, modelId, fallbackProviderId, fallbackModelId, followedBy },
    });
    return { followedBy };
  }

  /** Les routes de conversation qui partageaient la cible précédente prennent la nouvelle. */
  private async moveFollowers(guildId: string, previous: RouteTarget | null, target: RouteTarget): Promise<string[]> {
    const followedBy: string[] = [];
    for (const follower of CONVERSATION_FOLLOWERS) {
      const sibling = await this.prisma.capabilityRoute.findUnique({ where: { guildId_capability: { guildId, capability: follower } } });
      if (!sameTarget(sibling, previous)) continue;
      await this.prisma.capabilityRoute.update({ where: { guildId_capability: { guildId, capability: follower } }, data: target });
      followedBy.push(follower);
    }
    return followedBy;
  }

  /** Fournisseur de repli d'une route : celui donné (identifiant ou slug), `null` le retire, absent il est conservé. */
  private async fallbackId(guildId: string, input: RouteInput, existing: { fallbackProviderId: string | null } | null): Promise<string | null> {
    if (input.fallbackProviderId === undefined) return existing?.fallbackProviderId ?? null;
    if (!input.fallbackProviderId) return null;
    const fallback = await this.prisma.guildProvider.findFirst({ where: { guildId, OR: [{ id: input.fallbackProviderId }, { slug: input.fallbackProviderId }] } });
    if (!fallback) throw new ProviderError('Fournisseur de repli introuvable sur ce serveur.', 'invalid');
    return fallback.id;
  }

  async removeRoute(guildId: string, capability: string, actorId: string): Promise<boolean> {
    const result = await this.prisma.capabilityRoute.deleteMany({ where: { guildId, capability } });
    if (result.count > 0) this.audit.record({ guildId, source: 'agent', action: 'capability.unbound', actorId, metadata: { capability } });
    this.invalidate(guildId);
    return result.count > 0;
  }

  /** Routes d'un serveur, avec leurs fournisseurs résolus (cache court : le client LLM interroge à chaque appel). */
  async routes(guildId: string): Promise<ResolvedRoute[]> {
    const cached = this.routesCache.get(guildId);
    if (cached && Date.now() - cached.at < ROUTES_CACHE_TTL_MS) return cached.routes;
    const routes = this.loadRoutes(guildId);
    this.routesCache.set(guildId, { at: Date.now(), routes });
    routes.catch(() => this.routesCache.delete(guildId));
    return routes;
  }

  /** Invalide le cache des routes d'un serveur (après toute écriture). */
  private invalidate(guildId: string): void {
    this.routesCache.delete(guildId);
  }

  private async loadRoutes(guildId: string): Promise<ResolvedRoute[]> {
    const rows = await this.prisma.capabilityRoute.findMany({ where: { guildId }, orderBy: { capability: 'asc' } });
    const providers = await this.list(guildId);
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    const resolved: ResolvedRoute[] = [];
    for (const row of rows) {
      if (!isCapability(row.capability)) continue;
      const provider = byId.get(row.providerId);
      if (!provider) continue;
      const fallbackProvider = row.fallbackProviderId ? (byId.get(row.fallbackProviderId) ?? null) : null;
      resolved.push({
        capability: row.capability,
        provider,
        modelId: row.modelId,
        fallback: fallbackProvider ? { provider: fallbackProvider, modelId: row.fallbackModelId || row.modelId } : null,
        params: parseRecord(row.paramsJson),
      });
    }
    return resolved;
  }
}
