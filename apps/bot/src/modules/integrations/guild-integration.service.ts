import { Injectable } from '@spraxium/common';
import { AppEnv } from '../../app.env';
import { keyHintOf } from '../../shared/crypto/key-hint';
import { decryptSecret, encryptSecret } from '../../shared/crypto/secret-box';
import type { AuditEntry } from '../audit/audit.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { IntegrationService } from './integration.service';

/**
 * Intégrations d'un serveur : une API spécialisée (PixelLab...) avec la clé
 * propre à ce serveur, chiffrée. Ce n'est jamais un fournisseur de modèles
 * IA : les routes de capacités ne pointent pas ici.
 *
 * Sans ligne, ou ligne sans clé, l'intégration d'instance sert. Une ligne
 * désactivée coupe l'intégration pour ce serveur seulement.
 */

export type IntegrationOrigin = 'guild' | 'instance' | 'none';

/** Origine d'une écriture, pour l'audit : l'agent (outils Discord) par défaut, l'API du dashboard sinon. */
type AuditSource = NonNullable<AuditEntry['source']>;

/** Ce que la ligne d'un serveur porte à elle : jamais la clé, seulement sa présence. */
export interface OwnedIntegration {
  hasApiKey: boolean;
  baseUrl: string | null;
}

/** Une intégration telle qu'un serveur l'utilise. `config.apiKey` est DÉCHIFFRÉE : en mémoire seulement. */
export interface GuildIntegration {
  slug: string;
  enabled: boolean;
  origin: IntegrationOrigin;
  config: Record<string, string>;
}

/** Ce qu'une API peut montrer : jamais la clé. */
export interface GuildIntegrationStatus {
  slug: string;
  enabled: boolean;
  origin: IntegrationOrigin;
  hasApiKey: boolean;
  /** Les quatre derniers caractères de la clé, pour la reconnaître sans la lire. */
  keyHint: string | null;
  model: string | null;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/u;

/** Colonne JSON d'objet : objet vide si absente ou illisible. */
function parseRecord(json: string | null | undefined): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Indice d'une clé : le même, pour les intégrations, que pour les fournisseurs (règle unique). */
export { keyHintOf } from '../../shared/crypto/key-hint';

@Injectable()
export class GuildIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationService,
    private readonly env: AppEnv,
  ) {}

  /**
   * L'intégration telle que ce serveur l'utilise : la clé du serveur si sa
   * ligne en porte une, sinon celle d'instance ; l'URL et le modèle de la
   * ligne du serveur couvrent ceux d'instance.
   */
  async resolve(guildId: string | null, slug: string): Promise<GuildIntegration> {
    const instance = await this.instanceOf(slug);
    const row = guildId ? await this.prisma.guildIntegration.findUnique({ where: { guildId_slug: { guildId, slug } } }).catch(() => null) : null;
    if (row && !row.enabled) return { slug, enabled: false, origin: 'guild', config: {} };
    const apiKey = row?.encryptedApiKey ? decryptSecret(row.encryptedApiKey, this.secrets()) : null;
    const own: Record<string, string> = {};
    if (apiKey) own.apiKey = apiKey;
    if (row?.baseUrl) own.baseUrl = row.baseUrl;
    const model = parseRecord(row?.configJson).model;
    if (model) own.model = model;
    const config = { ...instance.config, ...own };
    if (!config.apiKey) return { slug, enabled: true, origin: 'none', config: {} };
    return { slug, enabled: true, origin: own.apiKey ? 'guild' : 'instance', config };
  }

  /** Cette intégration est-elle utilisable sur ce serveur (active, avec une clé) ? */
  async active(guildId: string | null, slug: string): Promise<boolean> {
    const resolved = await this.resolve(guildId, slug);
    return resolved.enabled && Boolean(resolved.config.apiKey);
  }

  /**
   * Ce que la ligne du serveur porte à elle (clé présente ou non, adresse), sans rien déchiffrer.
   * Null sans ligne : une ligne désactivée porte encore sa clé, que `resolve` ne montre pas.
   */
  async owned(guildId: string, slug: string): Promise<OwnedIntegration | null> {
    const row = await this.prisma.guildIntegration.findUnique({ where: { guildId_slug: { guildId, slug } } }).catch(() => null);
    return row ? { hasApiKey: Boolean(row.encryptedApiKey), baseUrl: row.baseUrl ?? null } : null;
  }

  /**
   * Écrit la ligne du serveur. Clé absente (`undefined`) : celle du serveur
   * est conservée ; clé vide ou `null` : elle est retirée, celle d'instance reprend.
   * `source` dit qui écrit : `agent` (outils Discord) par défaut, `api` depuis le dashboard.
   */
  async upsert(
    guildId: string,
    slug: string,
    fields: { apiKey?: string | null; baseUrl?: string | null; model?: string | null; enabled?: boolean },
    actorId: string,
    source: AuditSource = 'agent',
  ): Promise<void> {
    if (!SLUG_RE.test(slug)) throw new Error('Intégration invalide : lettres minuscules, chiffres et tirets.');
    const existing = await this.prisma.guildIntegration.findUnique({ where: { guildId_slug: { guildId, slug } } }).catch(() => null);
    const encryptedApiKey =
      fields.apiKey === undefined ? existing?.encryptedApiKey ?? null : fields.apiKey ? encryptSecret(fields.apiKey, this.secrets()) : null;
    const extra = parseRecord(existing?.configJson);
    if (fields.model !== undefined) extra.model = fields.model ?? '';
    const data = {
      enabled: fields.enabled ?? existing?.enabled ?? true,
      baseUrl: fields.baseUrl === undefined ? existing?.baseUrl ?? null : fields.baseUrl || null,
      encryptedApiKey,
      configJson: JSON.stringify(extra),
    };
    await this.prisma.guildIntegration.upsert({
      where: { guildId_slug: { guildId, slug } },
      create: { guildId, slug, ...data },
      update: data,
    });
    this.audit.record({
      guildId,
      source,
      action: 'integration.updated',
      actorId,
      metadata: { slug, enabled: data.enabled, keyChanged: fields.apiKey !== undefined, fields: Object.keys(fields) },
    });
  }

  /** Retire la ligne du serveur : l'intégration d'instance reprend. */
  async remove(guildId: string, slug: string, actorId: string, source: AuditSource = 'agent'): Promise<boolean> {
    const deleted = await this.prisma.guildIntegration.deleteMany({ where: { guildId, slug } }).catch(() => ({ count: 0 }));
    if (deleted.count > 0) this.audit.record({ guildId, source, action: 'integration.removed', actorId, metadata: { slug } });
    return deleted.count > 0;
  }

  /** État montrable : la clé n'y paraît jamais, seulement ses quatre derniers caractères. */
  async status(guildId: string, slug: string): Promise<GuildIntegrationStatus> {
    const resolved = await this.resolve(guildId, slug);
    return {
      slug,
      enabled: resolved.enabled,
      origin: resolved.origin,
      hasApiKey: Boolean(resolved.config.apiKey),
      keyHint: keyHintOf(resolved.config.apiKey),
      model: resolved.config.model ?? null,
    };
  }

  private async instanceOf(slug: string): Promise<GuildIntegration> {
    const resolved = await this.integrations.get(slug).catch(() => null);
    if (!resolved || resolved.source === 'none') return { slug, enabled: true, origin: 'none', config: {} };
    return { slug, enabled: true, origin: 'instance', config: resolved.config };
  }

  private secrets() {
    return { encryption: this.env.ENCRYPTION_SECRET, betterAuth: this.env.BETTER_AUTH_SECRET, token: this.env.token };
  }
}
