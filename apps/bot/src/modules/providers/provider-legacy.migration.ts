import { Injectable } from '@spraxium/common';
import { AppEnv } from '../../app.env';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import type { IntegrationService } from '../integrations/integration.service';
import { getIntegrations } from '../integrations/integration.runtime';
import { normalizeProviderUrl } from './provider-http';
import { GuildProviderService } from './provider-store.service';
import type { Capability, ProviderConfig } from './provider.types';

/**
 * Migration ADDITIVE des intégrations d'instance (lignes IntegrationConfig
 * `llm`, `pixellab`, `kie` et variables d'environnement `LLM_*`) vers des
 * fournisseurs du serveur. Lancée une seule fois par serveur, à la première
 * résolution d'une capacité : les lignes d'origine ne sont ni déplacées ni
 * supprimées, le bot continue de fonctionner sans elles.
 */

const MIGRATION_MARKER = 'provider.legacy_migrated';

/** Marque, dans les options d'un fournisseur, d'une copie de la configuration d'instance. */
export const INSTANCE_SOURCE = 'instance:llm';

/** Clés réservées des options : l'origine de la création, et le modèle d'instance d'alors. */
const SOURCE_KEY = '_source';
const SOURCE_MODEL_KEY = '_model';

/** Fragment JSON recherché en base pour retrouver les copies d'instance. */
const INSTANCE_MARK = JSON.stringify({ [SOURCE_KEY]: INSTANCE_SOURCE }).slice(1, -1);

/** Opérations du fournisseur PixelLab (API dédiée, branchée en HTTP générique). */
const PIXELLAB_OPERATIONS = {
  'image.generate': {
    method: 'POST',
    path: '/v2/create-image-pixflux',
    body: { description: '{{prompt}}', image_size: { width: '{{width}}', height: '{{height}}' }, no_background: '{{noBackground}}' },
    responsePath: 'image',
  },
};

@Injectable()
export class ProviderLegacyMigration {
  private readonly done = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly env: AppEnv,
    private readonly store: GuildProviderService,
  ) {}

  /** Les intégrations d'instance, lues au moment de l'appel (IntegrationModule se charge après celui-ci). */
  private integrations(): IntegrationService {
    return getIntegrations();
  }

  /** Une seule fois par serveur (trace d'audit), jamais deux fois dans le même processus. */
  async ensureMigrated(guildId: string): Promise<void> {
    if (this.done.has(guildId)) return;
    this.done.add(guildId);
    const marker = await this.prisma.auditLog.findFirst({ where: { guildId, action: MIGRATION_MARKER }, select: { id: true } }).catch(() => null);
    if (marker) return;
    const created = await this.migrate(guildId);
    this.audit.record({ guildId, source: 'agent', action: MIGRATION_MARKER, actorId: 'system', metadata: created });
  }

  /**
   * La configuration d'instance (modale owner ou env) a changé : ses copies
   * par serveur, créées par la migration, suivent (clé, URL, modèle) tant
   * qu'un administrateur ne les a pas reprises. Sans cela, une clé tournée
   * par le owner laisserait tous les serveurs migrés sur l'ancienne.
   */
  async reconcileInstance(): Promise<{ checked: number; updated: number }> {
    const instance = await this.integrations().get('llm').catch(() => null);
    const { apiKey, baseUrl, model } = instance?.config ?? {};
    if (instance?.source === 'none' || !apiKey || !baseUrl) return { checked: 0, updated: 0 };
    const current = { apiKey, baseUrl, model: model ?? '' };
    const copies = await this.store.listMarked(INSTANCE_MARK).catch(() => [] as ProviderConfig[]);
    let updated = 0;
    for (const copy of copies) {
      if (await this.safe(() => this.syncCopy(copy, current))) updated += 1;
    }
    return { checked: copies.length, updated };
  }

  private async migrate(guildId: string): Promise<{ providers: string[]; routes: number }> {
    const providers: string[] = [];
    let routes = 0;
    const llm = await this.integrations().get('llm').catch(() => null);
    const model = llm?.config.model || this.env.LLM_MODEL || '';
    const llmProvider = await this.createLlmProvider(guildId, llm?.source === 'none' ? null : llm, model, providers);
    if (llmProvider && model) {
      for (const capability of ['chat.default', 'chat.reasoning', 'chat.ingestion'] as const) {
        if (await this.bind(guildId, capability, llmProvider, model)) routes += 1;
      }
    }
    const pixellabKey = (await this.integrations().get('pixellab').catch(() => null))?.config.apiKey;
    if (pixellabKey) {
      const created = await this.safe(() =>
        this.store.upsert(
          guildId,
          {
            slug: 'pixellab',
            displayName: 'PixelLab',
            protocol: 'generic-http',
            baseUrl: 'https://api.pixellab.ai',
            apiKey: pixellabKey,
            extraConfig: {
              [SOURCE_KEY]: 'instance:pixellab',
              operations: PIXELLAB_OPERATIONS,
              models: [{ id: 'create-image-pixflux', name: 'PixelLab pixflux (pixel art)', kind: 'image' }],
            },
          },
          'system',
        ),
      );
      if (created) {
        providers.push(created.slug);
        if (await this.bind(guildId, 'image.generate', created, 'create-image-pixflux')) routes += 1;
      }
    }
    const kie = await this.integrations().get('kie').catch(() => null);
    const kieKey = kie?.config.apiKey;
    if (kieKey) {
      const created = await this.safe(() =>
        this.store.upsert(
          guildId,
          { slug: 'kie-main', displayName: 'kie.ai', protocol: 'kie-unified', baseUrl: 'https://api.kie.ai', apiKey: kieKey, extraConfig: { [SOURCE_KEY]: 'instance:kie' } },
          'system',
        ),
      );
      if (created) {
        providers.push(created.slug);
        if (await this.bind(guildId, 'music.generate', created, kie?.config.model || 'V6_MINI')) routes += 1;
        if (await this.bind(guildId, 'custom.kie-image', created, 'z-image')) routes += 1;
      }
    }
    return { providers, routes };
  }

  /** Le fournisseur IA d'instance : nommé d'après son hôte (deepseek-official, openrouter...), marqué comme sa copie. */
  private async createLlmProvider(
    guildId: string,
    llm: { config: Record<string, string> } | null,
    model: string,
    providers: string[],
  ): Promise<{ id: string } | null> {
    const apiKey = llm?.config.apiKey || this.env.LLM_API_KEY;
    const baseUrl = llm?.config.baseUrl || this.env.LLM_API_URL;
    if (!apiKey || !baseUrl) return null;
    let host = '';
    try {
      host = new URL(baseUrl).hostname;
    } catch {
      return null;
    }
    const created = await this.safe(() =>
      this.store.upsert(
        guildId,
        { slug: slugFromHost(host), displayName: `IA (${host})`, protocol: 'openai-chat', baseUrl, apiKey, extraConfig: { [SOURCE_KEY]: INSTANCE_SOURCE, [SOURCE_MODEL_KEY]: model } },
        'system',
      ),
    );
    if (created) providers.push(created.slug);
    return created;
  }

  /** Aligne une copie sur l'instance. Les routes rebindées par un administrateur gardent leur modèle. */
  private async syncCopy(copy: ProviderConfig, instance: { apiKey: string; baseUrl: string; model: string }): Promise<boolean> {
    const migrated = copy.extraConfig[SOURCE_MODEL_KEY];
    const migratedModel = typeof migrated === 'string' ? migrated : '';
    if (copy.apiKey === instance.apiKey && normalizeProviderUrl(copy.baseUrl) === normalizeProviderUrl(instance.baseUrl) && migratedModel === instance.model) {
      return false;
    }
    const routes = (await this.store.routes(copy.guildId)).filter((route) => route.provider.id === copy.id);
    await this.store.upsert(
      copy.guildId,
      {
        slug: copy.slug,
        displayName: copy.displayName,
        protocol: 'openai-chat',
        baseUrl: instance.baseUrl,
        apiKey: instance.apiKey,
        extraConfig: { ...copy.extraConfig, [SOURCE_MODEL_KEY]: instance.model },
        enabled: copy.enabled,
      },
      'system',
    );
    for (const route of routes) {
      if (migratedModel && route.modelId !== migratedModel) continue;
      await this.store.bindRoute(
        copy.guildId,
        route.capability,
        {
          providerId: copy.id,
          modelId: instance.model || route.modelId,
          fallbackProviderId: route.fallback?.provider.id ?? null,
          fallbackModelId: route.fallback?.modelId ?? null,
          params: route.params,
        },
        'system',
      );
    }
    return true;
  }

  private bind(guildId: string, capability: Capability, provider: { id: string }, modelId: string): Promise<boolean> {
    return this.safe(async () => {
      await this.store.bindRoute(guildId, capability, { providerId: provider.id, modelId }, 'system');
      return true;
    }).then((result) => result === true);
  }

  /** Une étape de migration n'échoue jamais la suivante. */
  private async safe<T>(step: () => Promise<T>): Promise<T | null> {
    try {
      return await step();
    } catch {
      return null;
    }
  }
}

/** Slug lisible depuis un hôte : api.deepseek.com → deepseek-official, api.openrouter.ai → openrouter. */
export function slugFromHost(host: string): string {
  const labels = host.toLowerCase().split('.').filter((label) => label && !['www', 'api', 'ai', 'com', 'io', 'net', 'dev'].includes(label));
  const base = labels.at(-2) ?? labels[0] ?? 'fournisseur';
  return base === 'deepseek' ? 'deepseek-official' : base;
}
