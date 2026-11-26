import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import type { ToolResult } from '@10cordes/shared';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { PrismaService } from '../database/prisma.service';
import { registerComponentAction } from '../../shared/actions/registry';
import {
  CollectionQuotaExceededError,
  DYNAMIC_COLLECTION_NAME_RULE,
  collectionQuotaPolicy,
} from '../../core/security/collection-quota.policy';
import {
  DYNAMIC_COLLECTION_TOO_LARGE,
  collectionNames,
  findUnsafeKeys,
  isBoundedDocument,
  resolveCollection,
  type CollectionDef,
} from './collections';
import { counterActionExecutor } from './counter.action';
import { buildRecordTools } from './records.tools';

/**
 * Store générique typé : les enregistrements vivent dans AgentRecord
 * (collection + JSON versionné).
 *
 * Deux familles de collections :
 * - NATIVES (7, registre en code) : schéma Zod strict, validation à l'écriture
 *   et à la fusion, refus actionnable listant les champs attendus ;
 * - DYNAMIQUES (créées à la demande) : nom validé et contenu borné, sous quota
 *   par serveur (CollectionQuotaPolicy). C'est ce qui permet aux recettes de la
 *   bibliothèque d'écrire dans casino_balance, giveaway_entries, etc.
 */
type Validation = { ok: true; data: Record<string, unknown> } | { ok: false; summary: string };

export interface CollectionsOverview {
  native: Array<{ name: string; description: string }>;
  dynamic: Array<{ name: string; records: number }>;
}

@Injectable()
export class RecordsService implements SpraxiumOnBoot {
  private readonly log = new Logger('Records');

  constructor(private readonly prisma: PrismaService) {}

  onBoot(): void {
    const tools = buildRecordTools(this);
    for (const tool of tools) getToolRegistry().register(tool);
    this.log.info(
      `${tools.length} tools records enregistrés (${collectionNames().length} collections natives + collections dynamiques : ${collectionQuotaPolicy.describe()}).`,
    );
    registerComponentAction('counter', counterActionExecutor(this.prisma));
  }

  /** Collections natives, et collections dynamiques déjà ouvertes sur ce serveur. */
  async describeCollections(guildId: string): Promise<CollectionsOverview> {
    const grouped = await this.prisma.agentRecord.groupBy({
      by: ['collection'],
      where: { guildId },
      _count: { id: true },
    });
    return {
      native: collectionNames().map((name) => ({ name, description: resolveCollection(name)?.description ?? '' })),
      dynamic: grouped
        .filter((row) => !collectionNames().includes(row.collection))
        .map((row) => ({ name: row.collection, records: row._count.id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** Valide un document contre sa collection : native (schéma strict) ou dynamique (contenu borné). */
  validate(collection: string, data: unknown): Validation {
    const def = resolveCollection(collection);
    if (!def) {
      return {
        ok: false,
        summary:
          `Nom de collection refusé : « ${collection} ». Collections natives : ${collectionNames().join(', ')}. ` +
          `Pour une collection dynamique, respecte : ${DYNAMIC_COLLECTION_NAME_RULE}.`,
      };
    }
    return this.parse(collection, def, data);
  }

  async create(guildId: string, userId: string, collection: string, data: unknown): Promise<ToolResult> {
    const check = this.validate(collection, data);
    if (!check.ok) return check;

    const recordsInGuild = await this.prisma.agentRecord.count({ where: { guildId } });
    // Ouvrir une collection de plus ne consomme le quota que si elle est nouvelle.
    const alreadyOpen = await this.prisma.agentRecord.findFirst({ where: { guildId, collection }, select: { id: true } });
    const opened = alreadyOpen
      ? []
      : await this.prisma.agentRecord.findMany({ where: { guildId }, distinct: ['collection'], select: { collection: true } });
    try {
      collectionQuotaPolicy.assertCanWriteRecord(recordsInGuild);
      if (!alreadyOpen) collectionQuotaPolicy.assertCanOpenCollection(opened.length);
    } catch (error) {
      // Refus attendu d'une policy : renvoyé comme les autres refus du store,
      // jamais remonté en exception au registry.
      if (error instanceof CollectionQuotaExceededError) return { ok: false, summary: error.message };
      throw error;
    }

    const created = await this.prisma.agentRecord.create({
      data: { guildId, collection, data: JSON.stringify({ version: 1, ...check.data }), createdBy: userId },
    });
    return { ok: true, summary: `Enregistrement créé dans « ${collection} » (id ${created.id.slice(-6)}).`, data: { recordId: created.id } };
  }

  async update(guildId: string, recordId: string, patch: Record<string, unknown>): Promise<ToolResult> {
    const record = await this.prisma.agentRecord.findFirst({ where: { id: recordId, guildId } });
    if (!record) return { ok: false, summary: 'Enregistrement introuvable.' };
    let current: Record<string, unknown>;
    try {
      current = JSON.parse(record.data || '{}') as Record<string, unknown>;
    } catch {
      current = {};
    }
    const check = this.validate(record.collection, { ...current, ...patch });
    if (!check.ok) return check;
    await this.prisma.agentRecord.update({
      where: { id: record.id },
      data: { data: JSON.stringify({ version: 1, ...check.data }) },
    });
    return { ok: true, summary: `Enregistrement ${recordId.slice(-6)} mis à jour.` };
  }

  async get(guildId: string, recordId: string): Promise<ToolResult> {
    const record = await this.prisma.agentRecord.findFirst({ where: { id: recordId, guildId } });
    if (!record) return { ok: false, summary: 'Enregistrement introuvable.' };
    return { ok: true, summary: `« ${record.collection} » : ${record.data}` };
  }

  async list(guildId: string, collection: string, limit: number): Promise<ToolResult> {
    const rows = await this.prisma.agentRecord.findMany({
      where: { guildId, collection },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    if (rows.length === 0) return { ok: true, summary: `Aucun enregistrement dans « ${collection} ».` };
    return { ok: true, summary: `${rows.length} enregistrement(s) « ${collection} » : ${rows.map((row) => `${row.id.slice(-6)} : ${row.data.slice(0, 140)}`).join(' | ')}` };
  }

  async search(guildId: string, collection: string, query: string): Promise<ToolResult> {
    const rows = await this.prisma.agentRecord.findMany({
      where: { guildId, collection, data: this.prisma.dialect.textContains(query) },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    if (rows.length === 0) return { ok: true, summary: `Aucun résultat pour « ${query} » dans « ${collection} ».` };
    return { ok: true, summary: `${rows.length} résultat(s) : ${rows.map((row) => `${row.id.slice(-6)} : ${row.data.slice(0, 140)}`).join(' | ')}` };
  }

  async remove(guildId: string, recordId: string): Promise<ToolResult> {
    const deleted = await this.prisma.agentRecord.deleteMany({ where: { id: recordId, guildId } });
    return deleted.count > 0 ? { ok: true, summary: 'Enregistrement supprimé.' } : { ok: false, summary: 'Enregistrement introuvable.' };
  }

  private parse(collection: string, def: CollectionDef, data: unknown): Validation {
    // Contrôles sur l'entrée BRUTE, avant toute reconstruction par Zod : une
    // clé __proto__ ne doit jamais dépendre de la façon dont le parseur
    // reconstruit l'objet en sortie.
    const unsafe = findUnsafeKeys(data);
    if (unsafe.length > 0) {
      return { ok: false, summary: `Données refusées pour la collection « ${collection} » : clé interdite (${unsafe[0]}).` };
    }
    if (def.dynamic && !isBoundedDocument(data)) {
      return { ok: false, summary: `${DYNAMIC_COLLECTION_TOO_LARGE} (« ${collection} »).` };
    }
    const parsed = def.schema.safeParse(data);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join('.') || 'racine'} : ${issue.message}`).join(' ; ');
      return { ok: false, summary: `Données invalides pour la collection « ${collection} ». Détail : ${issues}` };
    }
    return { ok: true, data: parsed.data as Record<string, unknown> };
  }
}
