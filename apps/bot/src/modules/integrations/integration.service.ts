import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { z } from 'zod';
import { defineTool, type BotTool } from '@10cordes/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { AppEnv } from '../../app.env';
import { encryptSecret, decryptSecret, isEncrypted } from '../../shared/crypto/secret-box';
import { fileLog } from '../logging/file-log.service';
import { bindIntegrations } from './integration.runtime';

/**
 * IntegrationService (R2) : la configuration d'INSTANCE, commune à tous les
 * serveurs du bot (fournisseur IA, PixelLab, kie.ai), stockée en DB avec sa
 * clé API CHIFFRÉE (AES-256-GCM).
 *
 * La base a la priorité absolue : dès qu'elle connaît une intégration, les
 * variables d'environnement (LLM_*, KIE_API_KEY, PIXELLAB_API_KEY) sont
 * ignorées pour tout le catalogue. Elles ne servent qu'une fois, à l'amorçage
 * du bot, pour remplir une base vide (import unique, jamais une réécriture) :
 * un `.env` sans ses clés suffit ensuite à démarrer, la clé maître de
 * chiffrement (ENCRYPTION_SECRET ou BETTER_AUTH_SECRET) restant requise.
 * Un serveur peut garder sa propre clé par intégration (GuildIntegrationService).
 */

export interface IntegrationDef {
  readonly id: string;
  readonly kind: 'llm' | 'image' | 'music' | 'tool';
  readonly label: string;
  readonly description: string;
  readonly fields: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly placeholder?: string;
    readonly required: boolean;
    readonly secret: boolean;
  }>;
}

/** Catalogue en code (extensible : un marketplace GitHub suivra le même format). */
export const INTEGRATION_CATALOG: readonly IntegrationDef[] = [
  {
    id: 'llm',
    kind: 'llm',
    label: 'Fournisseur IA',
    description: 'N\u0027importe quel fournisseur compatible OpenAI (DeepSeek, OpenAI, OpenRouter, Groq, local...). Requis pour parler au bot.',
    fields: [
      { id: 'baseUrl', label: 'Base URL de l\u0027API', placeholder: 'https://api.deepseek.com ou https://openrouter.ai/api/v1', required: true, secret: false },
      { id: 'apiKey', label: 'Clé API', placeholder: 'sk-...', required: true, secret: true },
      { id: 'model', label: 'Modèle (optionnel)', placeholder: 'deepseek-flash, gpt-4o-mini...', required: false, secret: false },
    ],
  },
  {
    id: 'pixellab',
    kind: 'image',
    label: 'PixelLab',
    description: 'Génération pixel art (icônes, émojis, sprites).',
    fields: [{ id: 'apiKey', label: 'Clé PixelLab', placeholder: 'pixl-...', required: true, secret: true }],
  },
  {
    id: 'kie',
    kind: 'music',
    label: 'kie.ai (Suno)',
    description: 'Génération musicale Suno via kie.ai.',
    fields: [
      { id: 'apiKey', label: 'Clé kie.ai', placeholder: '...', required: true, secret: true },
      { id: 'model', label: 'Modèle Suno (optionnel)', placeholder: 'V6_MINI ou V6', required: false, secret: false },
    ],
  },
];

export interface ResolvedIntegration {
  id: string;
  config: Record<string, string>;
  source: 'db' | 'env' | 'none';
}

@Injectable()
export class IntegrationService implements SpraxiumOnBoot {
  private readonly log = new Logger('Integrations');
  private readonly cache = new Map<string, ResolvedIntegration>();
  /** L'import de l'environnement ne court qu'une fois par processus : la première lecture l'attend, les autres le partagent. */
  private importRun: Promise<string[]> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly env: AppEnv,
  ) {}

  async onBoot(): Promise<void> {
    getToolRegistry().register(this.statusTool());
    // Accès runtime pour ConfigThreadService (GuildConfigModule se charge
    // avant ce module dans l'ordre d'AppModule, pattern getLlm).
    bindIntegrations(this);
    await this.migrateLegacy();
    await this.importFromEnv();
    this.log.info(`Integrations ready (${INTEGRATION_CATALOG.length} au catalogue, chiffrement AES-256-GCM).`);
  }

  private secrets() {
    // DISCORD_TOKEN vit sur SpraxiumBaseEnv.token.
    return { encryption: this.env.ENCRYPTION_SECRET, betterAuth: this.env.BETTER_AUTH_SECRET, token: this.env.token };
  }

  /** Ce que l'environnement propose pour une intégration : rien sans clé. */
  private envFields(id: string): Record<string, string> {
    const env = this.env;
    const fields: Record<string, Record<string, string | undefined>> = {
      llm: { baseUrl: env.LLM_API_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL },
      pixellab: { apiKey: env.PIXELLAB_API_KEY },
      kie: { apiKey: env.KIE_API_KEY, model: env.KIE_MODEL },
    };
    const source = fields[id] ?? {};
    if (!source.apiKey) return {};
    return Object.fromEntries(Object.entries(source).filter((pair): pair is [string, string] => Boolean(pair[1])));
  }

  /** La base ne connaît-elle encore aucune intégration ? Sur base illisible, oui : l'environnement reste le repli. */
  private async databaseIsEmpty(): Promise<boolean> {
    const count = await this.prisma.integrationConfig.count().catch(() => 0);
    return count === 0;
  }

  /**
   * Import unique : une intégration sans ligne en base est remplie depuis
   * l'environnement, si celui-ci porte sa clé. Une ligne existante n'est
   * jamais réécrite. La première lecture d'une intégration déclenche cet
   * import et l'attend : aucun service ne voit un état d'avant import. Rend
   * les intégrations importées, jamais une erreur (la base reste seule maître).
   */
  importFromEnv(): Promise<string[]> {
    if (!this.importRun) {
      this.importRun = this.runImport().catch((error: unknown) => {
        this.log.warn(`Import de l\u0027environnement impossible (${error instanceof Error ? error.message.slice(0, 120) : 'erreur inconnue'}).`);
        return [];
      });
    }
    return this.importRun;
  }

  private async runImport(): Promise<string[]> {
    const imported: string[] = [];
    for (const def of INTEGRATION_CATALOG) {
      const fields = this.envFields(def.id);
      if (!fields.apiKey) continue;
      const existing = await this.prisma.integrationConfig.findUnique({ where: { id: def.id } }).catch(() => null);
      if (existing) continue;
      try {
        await this.upsert(def.id, fields, 'bootstrap');
        imported.push(def.id);
      } catch (error) {
        this.log.warn(`Import d\u0027environnement impossible pour ${def.id} (${error instanceof Error ? error.message.slice(0, 120) : 'erreur inconnue'}).`);
      }
    }
    if (imported.length > 0) {
      this.audit.record({ guildId: null, source: 'agent', action: 'instance.imported', actorId: 'bootstrap', metadata: { ids: imported } });
      this.log.info(`Intégrations lues dans l\u0027environnement et chiffrées en base : ${imported.join(', ')}.`);
    }
    return imported;
  }

  /** Migration : chiffre les lignes IntegrationConfig héritées (plaintext). */
  private async migrateLegacy(): Promise<void> {
    try {
      const rows = await this.prisma.integrationConfig.findMany();
      for (const row of rows) {
        if (!isEncrypted(row.apiKey)) {
          await this.prisma.integrationConfig.update({
            where: { id: row.id },
            data: { apiKey: encryptSecret(row.apiKey, this.secrets()) },
          });
          this.log.info(`Clé ${row.id} chiffrée (migration AES-256-GCM).`);
        }
      }
    } catch {
      /* table vide au premier boot */
    }
  }

  /** Résout une intégration d'instance : sa ligne en base (chiffrée) ; à défaut l'environnement, et seulement tant que la base ne connaît aucune intégration. */
  async get(id: string): Promise<ResolvedIntegration> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const def = INTEGRATION_CATALOG.find((entry) => entry.id === id);
    if (!def) return { id, config: {}, source: 'none' };

    const config: Record<string, string> = {};
    let source: ResolvedIntegration['source'] = 'none';

    // L'import (une fois par processus) est terminé avant la lecture : la ligne
    // en base fait foi, chiffrée.
    await this.importFromEnv();
    const row = await this.prisma.integrationConfig.findUnique({ where: { id } }).catch(() => null);
    if (row) {
      const decrypted = decryptSecret(row.apiKey, this.secrets());
      if (decrypted) {
        config.apiKey = decrypted;
        if (row.baseUrl) config.baseUrl = row.baseUrl;
        if (row.model) config.model = row.model;
        source = 'db';
      }
    }

    // Repli d'urgence : l'environnement ne sert que tant que la base ne
    // connaît AUCUNE intégration (l'import à l'amorçage le vide de son rôle).
    if (source === 'none' && (await this.databaseIsEmpty())) {
      Object.assign(config, this.envFields(id));
      if (config.apiKey) source = 'env';
    }

    const resolved: ResolvedIntegration = { id, config, source };
    this.cache.set(id, resolved);
    return resolved;
  }

  /** Sauvegarde une config (chiffre les secrets). Invalide le cache. */
  async upsert(id: string, fields: Record<string, string>, actorId: string): Promise<void> {
    const def = INTEGRATION_CATALOG.find((entry) => entry.id === id);
    if (!def) throw new Error(`Intégration « ${id} » inconnue.`);
    const apiKey = fields.apiKey ?? '';
    const encrypted = apiKey ? encryptSecret(apiKey, this.secrets()) : '';
    await this.prisma.integrationConfig.upsert({
      where: { id },
      create: {
        id,
        kind: def.kind,
        label: def.label,
        baseUrl: fields.baseUrl ?? '',
        apiKey: encrypted,
        model: fields.model ?? '',
      },
      update: {
        kind: def.kind,
        label: def.label,
        baseUrl: fields.baseUrl ?? '',
        ...(apiKey ? { apiKey: encrypted } : {}),
        model: fields.model ?? '',
      },
    });
    this.cache.delete(id);
    this.audit.record({
      guildId: null,
      source: 'agent',
      action: 'integration.configured',
      actorId,
      metadata: { id, fields: Object.keys(fields) },
    });
    fileLog()?.event('info', 'integrations', 'configured', { id });
  }

  /** Supprime une intégration. */
  async remove(id: string): Promise<boolean> {
    const deleted = await this.prisma.integrationConfig.deleteMany({ where: { id } }).catch(() => ({ count: 0 }));
    this.cache.delete(id);
    return deleted.count > 0;
  }

  /** Statut masqué d'une intégration (clé tronquée). */
  async status(id: string): Promise<{ id: string; label: string; source: string; maskedKey: string | null; model: string | null }> {
    const def = INTEGRATION_CATALOG.find((entry) => entry.id === id);
    const resolved = await this.get(id);
    const key = resolved.config.apiKey ?? '';
    const maskedKey = key.length > 8 ? `${key.slice(0, 5)}…${key.slice(-4)}` : key ? '••••' : null;
    return {
      id,
      label: def?.label ?? id,
      source: resolved.source,
      maskedKey,
      model: resolved.config.model ?? null,
    };
  }

  private statusTool(): BotTool {
    const service = this;
    return defineTool({
      name: 'integrations.status',
      description: 'Liste les intégrations disponibles (fournisseurs IA, image, musique) et leur état de connexion (source, clé masquée).',
      category: 'integrations',
      paramsSchema: z.object({}),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'Read-only. Si une intégration est « none », dis à l\u0027utilisateur qu\u0027il peut la connecter via le bouton « Connecter » qui apparaît quand il en a besoin, ou en te demandant de configurer.',
      handler: async () => {
        const lines: string[] = [];
        for (const def of INTEGRATION_CATALOG) {
          const status = await service.status(def.id);
          lines.push(`**${status.label}** : ${status.source === 'none' ? 'non connecté' : `${status.source} (${status.maskedKey})${status.model ? ` · ${status.model}` : ''}`}`);
        }
        return { ok: true, summary: lines.join('\n') };
      },
    });
  }
}
