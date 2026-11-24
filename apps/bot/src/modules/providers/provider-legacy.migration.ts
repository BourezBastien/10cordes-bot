import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { getIntegrations } from '../integrations/integration.runtime';
import { KIE_MODEL_CATALOG } from './adapters/kie-unified.catalog';
import { INSTANCE_SOURCES, type InstanceSource } from './instance-defaults';
import { planInstanceDefaults, type InstanceConfig, type InstanceProviderStep } from './instance-defaults.plan';
import { GuildProviderService } from './provider-store.service';
import type { ProviderConfig } from './provider.types';

/**
 * Réglages par défaut de l'instance, appliqués à chaque serveur : les
 * fournisseurs IA copiés de l'instance (DeepSeek, kie.ai) et les routes qui
 * vont avec. Trois chemins, UNE table (instance-defaults.ts) et UN plan
 * (instance-defaults.plan.ts, pur) :
 *
 *   premier appel d'un serveur   → ensureMigrated (une trace d'audit par serveur)
 *   démarrage, config d'instance → reconcileInstance (tous les serveurs connus)
 *
 * Une copie d'instance suit l'instance (clé tournée, modèle changé) ; un
 * fournisseur ou une route créés par un administrateur ne sont jamais
 * touchés. PixelLab n'est plus un fournisseur : ses anciennes copies sont
 * retirées, c'est une intégration (GuildIntegrationService).
 */

const MIGRATION_MARKER = 'provider.legacy_migrated';

/** Ce qu'une application a changé sur un serveur. */
export interface DefaultsApplied {
  providers: string[];
  routes: number;
  removed: number;
}

@Injectable()
export class ProviderLegacyMigration {
  private readonly log = new Logger('ProviderDefaults');
  private readonly done = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly store: GuildProviderService,
  ) {}

  /** Une seule fois par serveur (trace d'audit), jamais deux fois dans le même processus. */
  async ensureMigrated(guildId: string): Promise<void> {
    if (this.done.has(guildId)) return;
    this.done.add(guildId);
    const marker = await this.prisma.auditLog.findFirst({ where: { guildId, action: MIGRATION_MARKER }, select: { id: true } }).catch(() => null);
    if (marker) return;
    const applied = await this.applyDefaults(guildId);
    this.audit.record({ guildId, source: 'agent', action: MIGRATION_MARKER, actorId: 'system', metadata: { providers: applied.providers, routes: applied.routes, removed: applied.removed } });
  }

  /** La configuration d'instance a changé, ou le bot démarre : chaque serveur connu est aligné sur la table. */
  async reconcileInstance(): Promise<{ checked: number; updated: number }> {
    const guilds = await this.prisma.guild.findMany({ select: { id: true } }).catch(() => [] as Array<{ id: string }>);
    let updated = 0;
    for (const { id } of guilds) {
      const applied = await this.safe(() => this.applyDefaults(id));
      if (applied && applied.providers.length + applied.routes + applied.removed > 0) updated += 1;
    }
    return { checked: guilds.length, updated };
  }

  /** Applique le plan des réglages par défaut à un serveur : fournisseurs d'instance, routes, retraits. */
  async applyDefaults(guildId: string): Promise<DefaultsApplied> {
    const [llm, kie] = await Promise.all([this.instance('llm'), this.instance('kie')]);
    const plan = planInstanceDefaults({
      providers: await this.store.list(guildId),
      routes: await this.store.routes(guildId),
      llm,
      kie,
      catalog: KIE_MODEL_CATALOG,
    });
    const applied: DefaultsApplied = { providers: [], routes: 0, removed: 0 };
    const ids = new Map<InstanceSource, string>();
    for (const step of plan.providers) {
      const written = await this.safe(() => this.writeProvider(guildId, step));
      if (!written) continue;
      ids.set(step.source, written.provider.id);
      // Seul un fournisseur réellement écrit compte : une copie déjà conforme n'est pas un changement.
      if (written.changed) applied.providers.push(written.provider.slug);
    }
    for (const route of plan.routes) {
      const providerId = ids.get(route.source);
      if (!providerId) continue;
      const bound = await this.safe(async () => {
        await this.store.bindRoute(
          guildId,
          route.capability,
          { providerId, modelId: route.modelId, ...(route.keepFallback ? {} : { fallbackProviderId: null, fallbackModelId: null }) },
          'system',
        );
        return true;
      });
      if (bound === true) applied.routes += 1;
    }
    for (const legacy of plan.removals) {
      const removed = await this.safe(() => this.store.remove(guildId, legacy.providerId, 'system'));
      if (removed) applied.removed += 1;
    }
    if (applied.providers.length + applied.routes + applied.removed > 0) {
      this.audit.record({ guildId, source: 'agent', action: 'provider.defaults_applied', actorId: 'system', metadata: { ...applied } });
    }
    return applied;
  }

  /**
   * Écrit un fournisseur d'instance (création ou alignement), puis le renomme si la table lui donne un autre slug.
   * `changed` est faux pour une copie déjà conforme, que rien n'a réécrite.
   */
  private async writeProvider(guildId: string, step: InstanceProviderStep): Promise<{ provider: ProviderConfig; changed: boolean }> {
    const current = step.providerId ? ((await this.store.get(guildId, step.providerId)) ?? null) : null;
    let saved = current;
    let changed = step.write;
    if (step.write || !saved) {
      saved = await this.store.upsert(guildId, step.input, 'system');
      changed = true;
    }
    if (saved.slug !== step.slug) {
      await this.store.rename(guildId, saved.id, step.slug);
      saved = { ...saved, slug: step.slug };
      changed = true;
    }
    // Le catalogue de kie.ai tient lieu de liste initiale : les modèles image et musique n'y sont pas découverts en ligne.
    if (step.source === INSTANCE_SOURCES.kie && saved.models.length === 0) {
      await this.store.saveModels(guildId, saved.id, [...KIE_MODEL_CATALOG]);
      saved = { ...saved, models: [...KIE_MODEL_CATALOG] };
      changed = true;
    }
    return { provider: saved, changed };
  }

  /** Configuration d'instance d'une intégration, lue au moment de l'appel (IntegrationModule se charge après celui-ci). */
  private async instance(id: 'llm' | 'kie'): Promise<InstanceConfig | null> {
    const resolved = await getIntegrations()
      .get(id)
      .catch(() => null);
    const apiKey = resolved?.config.apiKey;
    if (!apiKey) return null;
    return { apiKey, ...(resolved?.config.baseUrl ? { baseUrl: resolved.config.baseUrl } : {}), ...(resolved?.config.model ? { model: resolved.config.model } : {}) };
  }

  /** Une étape n'échoue jamais la suivante. */
  private async safe<T>(step: () => Promise<T>): Promise<T | null> {
    try {
      return await step();
    } catch (error) {
      this.log.warn(`réglages par défaut impossibles pour une étape (${(error instanceof Error ? error.message : String(error)).slice(0, 140)})`);
      return null;
    }
  }
}
