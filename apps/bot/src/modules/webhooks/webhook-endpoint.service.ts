import { Injectable } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import type { WebhookCreate, WebhookEndpointView, WebhookPingResult, WebhookUpdate } from '@10cordes/shared';
import { AppEnv } from '../../app.env';
import { AuditService, type AuditEntry } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { providerSecrets } from '../providers/provider-store.codec';
import { authTypeOf, summaryOf, webhookFromRow, type WebhookEndpointRow } from './webhook-endpoint.codec';
import { WebhookEndpointError } from './webhook-endpoint.errors';
import { endpointChanges, newEndpointFields } from './webhook-endpoint.input';
import { WebhookEndpointPresenter } from './webhook-endpoint.presenter';
import { WebhookExecutor } from './webhook.executor';

/** Connecteurs au plus par serveur. */
export const WEBHOOKS_PER_GUILD_MAX = 20;

/** Origine d'une écriture ou d'un essai, pour le journal d'audit. */
export type WebhookAuditSource = NonNullable<AuditEntry['source']>;

/** Le résultat d'un appel, et de quoi l'auditer ; `webhookId` est null quand le connecteur est inconnu sur ce serveur. */
export interface WebhookCallResult extends WebhookPingResult {
  webhookId: string | null;
  slug: string | null;
}

/**
 * Connecteurs HTTP sortants d'un serveur (table `webhook_endpoints`) : des
 * endpoints REST qu'un déclencheur, une recette ou le modèle appellent.
 *
 * Le service orchestre : validation et mapping des champs
 * (`webhook-endpoint.input`), chiffrement à l'écriture et déchiffrement à la
 * lecture (`webhook-endpoint.codec`, la clé maîtresse des fournisseurs),
 * exécution (`WebhookExecutor`), vue sans secret (`WebhookEndpointPresenter`).
 * La valeur d'un en-tête secret ne ressort jamais : une vue, un résultat ou
 * un audit ne portent que ses NOMS. Un connecteur inconnu sur CE serveur est
 * introuvable, jamais une fuite vers un autre.
 */
@Injectable()
export class WebhookEndpointService {
  private readonly log = new Logger('Webhooks');
  // Collaborateurs non injectables : champs de classe, branchés dans le constructeur.
  private readonly presenter = new WebhookEndpointPresenter();
  private readonly executor: WebhookExecutor;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly env: AppEnv,
  ) {
    this.executor = new WebhookExecutor(prisma, this.log);
  }

  /** Connecteurs du serveur, du plus ancien au plus récent. */
  async list(guildId: string): Promise<WebhookEndpointView[]> {
    const rows = await this.prisma.webhookEndpoint.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } });
    return rows.map((row) => this.viewOf(row));
  }

  /** Un connecteur par identifiant ou par slug ; null s'il est inconnu sur ce serveur. */
  async get(guildId: string, idOrSlug: string): Promise<WebhookEndpointView | null> {
    const row = await this.rowOf(guildId, idOrSlug);
    return row ? this.viewOf(row) : null;
  }

  /** Crée un connecteur. Refus typés (422 ou 409 à l'API) : quota, slug pris, URL, en-têtes, gabarit. */
  async create(guildId: string, input: WebhookCreate, actorId: string, source: WebhookAuditSource): Promise<WebhookEndpointView> {
    const count = await this.prisma.webhookEndpoint.count({ where: { guildId } });
    if (count >= WEBHOOKS_PER_GUILD_MAX) {
      throw new WebhookEndpointError(`Quota atteint : ${WEBHOOKS_PER_GUILD_MAX} connecteurs au plus par serveur. Supprime-en un avant d\u0027en ajouter.`, 'limit');
    }
    const slug = input.slug.trim();
    const taken = await this.prisma.webhookEndpoint.findUnique({ where: { guildId_slug: { guildId, slug } }, select: { id: true } });
    if (taken) throw new WebhookEndpointError(`Slug « ${slug} » déjà pris sur ce serveur.`, 'conflict');
    const row = await this.prisma.webhookEndpoint
      .create({ data: { guildId, slug, ...newEndpointFields(input, this.secrets()) } })
      .catch((error: unknown) => {
        // Deux créations simultanées du même slug : l'index unique tranche, même refus que le contrôle qui précède.
        if (isUniqueViolation(error)) throw new WebhookEndpointError(`Slug « ${slug} » déjà pris sur ce serveur.`, 'conflict');
        throw error;
      });
    this.audit.record({ guildId, source, action: 'webhook.created', actorId, metadata: { webhookId: row.id, slug: row.slug } });
    return this.viewOf(row);
  }

  /**
   * Change un connecteur ; null s'il est inconnu sur ce serveur. Un champ
   * absent du corps ne bouge pas : les en-têtes secrets non redonnés restent
   * chiffrés tels quels (la colonne n'est pas réécrite).
   */
  async update(
    guildId: string,
    webhookId: string,
    input: WebhookUpdate,
    actorId: string,
    source: WebhookAuditSource,
  ): Promise<WebhookEndpointView | null> {
    const row = await this.prisma.webhookEndpoint.findFirst({ where: { guildId, id: webhookId } });
    if (!row) return null;
    const changes = endpointChanges(input, { authType: authTypeOf(row.authType), authHeaderName: row.authHeaderName }, this.secrets());
    if (Object.keys(changes).length === 0) return this.viewOf(row);
    const updated = await this.prisma.webhookEndpoint.update({ where: { id: row.id }, data: changes });
    this.audit.record({ guildId, source, action: 'webhook.updated', actorId, metadata: { webhookId: updated.id, slug: updated.slug } });
    return this.viewOf(updated);
  }

  /** Supprime un connecteur ; false s'il est inconnu sur ce serveur. */
  async remove(guildId: string, webhookId: string, actorId: string, source: WebhookAuditSource): Promise<boolean> {
    const row = await this.prisma.webhookEndpoint.findFirst({ where: { guildId, id: webhookId }, select: { id: true, slug: true } });
    if (!row) return false;
    const removed = await this.prisma.webhookEndpoint.deleteMany({ where: { guildId, id: row.id } });
    if (removed.count === 0) return false;
    this.audit.record({ guildId, source, action: 'webhook.deleted', actorId, metadata: { webhookId: row.id, slug: row.slug } });
    return true;
  }

  /** Essai d'un connecteur par le staff : charge utile `{ ping: true, at }`, dernier statut consigné, audit `webhook.ping`. Null s'il est inconnu. */
  async ping(guildId: string, webhookId: string, actorId: string, source: WebhookAuditSource): Promise<WebhookPingResult | null> {
    const row = await this.rowOf(guildId, webhookId);
    if (!row) return null;
    const result = await this.executor.run(this.endpointOf(row), { ping: true, at: new Date().toISOString() });
    this.audit.record({ guildId, source, action: 'webhook.ping', actorId, metadata: { webhookId: row.id, slug: row.slug, ok: result.ok, status: result.status } });
    return result;
  }

  /**
   * Appel d'un connecteur, par slug ou par identifiant. Ne journalise pas
   * lui-même : l'appelant (l'outil, un déclencheur) audite avec son acteur.
   */
  async call(guildId: string, idOrSlug: string, payload: Record<string, unknown>): Promise<WebhookCallResult> {
    const row = await this.rowOf(guildId, idOrSlug);
    if (!row) {
      return { ok: false, status: null, summary: `Connecteur « ${idOrSlug.slice(0, 60)} » introuvable sur ce serveur.`, extracted: null, ms: 0, webhookId: null, slug: null };
    }
    const result = await this.executor.run(this.endpointOf(row), payload);
    return { ...result, webhookId: row.id, slug: row.slug };
  }

  /** Ligne d'un connecteur de CE serveur, par identifiant ou par slug : un identifiant exact l'emporte sur un slug qui lui serait égal. */
  private async rowOf(guildId: string, idOrSlug: string): Promise<WebhookEndpointRow | null> {
    const rows = await this.prisma.webhookEndpoint.findMany({ where: { guildId, OR: [{ id: idOrSlug }, { slug: idOrSlug }] }, take: 2 });
    return rows.find((row) => row.id === idOrSlug) ?? rows[0] ?? null;
  }

  private endpointOf(row: WebhookEndpointRow) {
    return webhookFromRow(row, this.secrets());
  }

  private viewOf(row: WebhookEndpointRow) {
    return this.presenter.present(summaryOf(this.endpointOf(row)));
  }

  private secrets() {
    return providerSecrets(this.env);
  }
}

/** Erreur Prisma « contrainte unique violée » (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
