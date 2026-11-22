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

/**
 * IntegrationService (R2) — le cœur de la demande providers génériques :
 * chaque fournisseur (LLM, image, musique...) est une INTÉGRATION stockée
 * en DB avec sa clé API CHIFFRÉE (AES-256-GCM). L'utilisateur la configure
 * soit par modal Discord (bouton « Connecter »), soit l'env sert de
 * bootstrap (priorité DB > env). Le catalogue en code décrit les champs
 * attendus, la modale est GÉNÉRÉE dynamiquement.
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

/** Catalogue en code (extensible — un marketplace GitHub suivra le même format). */
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly env: AppEnv,
  ) {}

  onBoot(): void {
    getToolRegistry().register(this.statusTool());
    void this.migrateLegacy();
    this.log.info(`Integrations ready (${INTEGRATION_CATALOG.length} au catalogue, chiffrement AES-256-GCM).`);
  }

  private secrets() {
    // DISCORD_TOKEN vit sur SpraxiumBaseEnv.token.
    return { encryption: this.env.ENCRYPTION_SECRET, betterAuth: this.env.BETTER_AUTH_SECRET, token: this.env.token };
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

  /** Résout une intégration : DB (chiffrée) > env bootstrap > none. */
  async get(id: string): Promise<ResolvedIntegration> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const def = INTEGRATION_CATALOG.find((entry) => entry.id === id);
    if (!def) return { id, config: {}, source: 'none' };

    const config: Record<string, string> = {};
    let source: ResolvedIntegration['source'] = 'none';

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

    // Fallback env (bootstrap)
    if (source === 'none' && id === 'llm') {
      if (this.env.LLM_API_URL && this.env.LLM_API_KEY) {
        config.baseUrl = this.env.LLM_API_URL;
        config.apiKey = this.env.LLM_API_KEY;
        if (this.env.LLM_MODEL) config.model = this.env.LLM_MODEL;
        source = 'env';
      }
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
