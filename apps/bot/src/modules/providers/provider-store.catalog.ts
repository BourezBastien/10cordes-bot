import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { MODEL_ID_MAX, boundedModels } from './provider-store.codec';
import { mergeCatalog, parseModels } from './provider-store.json';
import type { ProviderWriteOrigin } from './provider-store.service';
import { ProviderError, type ProviderModel } from './provider.types';

/**
 * Catalogue des modèles d'un fournisseur (colonne `cachedModelsJson`) : ce
 * que le fournisseur liste, et les slugs ajoutés à la main. Collaborateur du
 * store des fournisseurs, construit par lui avec ses dépendances explicites.
 *
 * Un rafraîchissement ne remplace pas tout : les slugs saisis à la main que
 * le fournisseur ne liste pas restent (voir mergeCatalog). Un slug saisi à la
 * main ne déclare aucune famille : il ne refuse jamais une liaison
 * (assertModelServes), contrairement à un modèle découvert.
 */
export class ProviderCatalogStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    /** Le cache des routes relit les catalogues : il est invalidé après chaque écriture. */
    private readonly onChanged: (guildId: string) => void,
  ) {}

  /** Retient le catalogue DÉCOUVERT d'un fournisseur ; les slugs saisis à la main qu'il ne liste pas restent. */
  async save(guildId: string, providerId: string, discovered: ProviderModel[]): Promise<void> {
    const row = await this.prisma.guildProvider.findFirst({ where: { guildId, id: providerId }, select: { cachedModelsJson: true } });
    await this.write(guildId, providerId, mergeCatalog(boundedModels(discovered), boundedModels(parseModels(row?.cachedModelsJson ?? null))));
  }

  /** Ajoute un slug de modèle saisi à la main : il survit aux rafraîchissements. Déjà au catalogue : rien ne change. */
  async addManual(guildId: string, providerId: string, modelId: string, actorId: string, origin: ProviderWriteOrigin = 'agent'): Promise<ProviderModel[]> {
    const row = await this.rowOf(guildId, providerId);
    const id = modelId.trim().slice(0, MODEL_ID_MAX);
    if (!id) throw new ProviderError('Identifiant de modèle requis.', 'invalid');
    const models = parseModels(row.cachedModelsJson);
    if (models.some((model) => model.id === id)) return models;
    const saved = [...models, { id, origin: 'manual' as const }];
    await this.write(guildId, row.id, saved);
    this.audit.record({ guildId, source: origin, action: 'provider.model_added', actorId, metadata: { providerId: row.id, slug: row.slug, modelId: id } });
    return saved;
  }

  /**
   * Retire un slug saisi à la main. Le résultat dit ce qui a été trouvé :
   * `removed` ; `discovered` pour un modèle que le fournisseur liste (il ne
   * se retire pas) ; `missing` pour un modèle inconnu. Rien n'est écrit dans
   * ces deux derniers cas, et `models` est le catalogue, changé ou non.
   */
  async removeManual(guildId: string, providerId: string, modelId: string, actorId: string, origin: ProviderWriteOrigin = 'agent'): Promise<{ outcome: 'removed' | 'discovered' | 'missing'; models: ProviderModel[] }> {
    const row = await this.rowOf(guildId, providerId);
    const models = parseModels(row.cachedModelsJson);
    const target = models.find((model) => model.id === modelId);
    if (!target) return { outcome: 'missing', models };
    if (target.origin !== 'manual') return { outcome: 'discovered', models };
    const saved = models.filter((model) => model !== target);
    await this.write(guildId, row.id, saved);
    this.audit.record({ guildId, source: origin, action: 'provider.model_removed', actorId, metadata: { providerId: row.id, slug: row.slug, modelId } });
    return { outcome: 'removed', models: saved };
  }

  /** Ligne d'un fournisseur de CE serveur, pour lire ou réécrire son catalogue. */
  private async rowOf(guildId: string, providerId: string): Promise<{ id: string; slug: string; cachedModelsJson: string | null }> {
    const row = await this.prisma.guildProvider.findFirst({ where: { guildId, id: providerId }, select: { id: true, slug: true, cachedModelsJson: true } });
    if (!row) throw new ProviderError('Fournisseur introuvable sur ce serveur.', 'invalid');
    return row;
  }

  private async write(guildId: string, providerId: string, catalog: ProviderModel[]): Promise<void> {
    await this.prisma.guildProvider.update({ where: { id: providerId }, data: { cachedModelsJson: JSON.stringify(catalog) } });
    this.onChanged(guildId);
  }
}
