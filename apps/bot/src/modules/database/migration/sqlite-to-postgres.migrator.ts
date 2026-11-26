import { orderModels } from './migration-plan.ts';
import type { ModelReader, ModelTarget } from './migration-ports.ts';
import type { ModelInfo } from './schema-catalog.ts';
import { ModelMigrator } from './table-copy.ts';

/*
 * LA MIGRATION D'UNE BASE SQLITE VERS POSTGRESQL, de bout en bout. Elle copie
 * les lignes des tables que les deux bases partagent (celles des modèles du
 * schéma), dans l'ordre de leurs clés étrangères, puis relit les deux et
 * compare chaque ligne. Elle s'appuie sur un schéma déjà appliqué à la cible
 * (prisma migrate deploy) : elle ne crée rien.
 *
 * - idempotente : une ligne dont la clé existe déjà dans la cible n'est pas
 *   reprise, une migration interrompue reprend donc où elle s'est arrêtée ;
 * - sans perte : la source n'est jamais écrite, et la cible n'est jamais
 *   corrigée (une ligne qui diffère est signalée, pas remplacée) ;
 * - sans valeur : rien de ce qu'elle affiche ne vient d'une ligne, seulement
 *   des noms de tables, des colonnes et des comptes.
 */

/** Lignes lues et écrites par lot. */
export const MIGRATION_BATCH_SIZE = 500;

export interface TableReport {
  readonly model: string;
  readonly table: string;
  readonly sourceRows: number;
  readonly inserted: number;
  readonly batches: number;
  readonly secrets: number;
}

export interface MigrationReport {
  /** Les tables de la source qu'aucun modèle ne décrit : rien n'en est copié. */
  readonly skippedTables: readonly string[];
  /** Les modèles dont la table n'existe pas dans la source : rien à copier. */
  readonly absentTables: readonly string[];
  /** Les tables contrôlées dans la source (et copiées, sauf en essai à sec). */
  readonly controlledTables: number;
  readonly tables: readonly TableReport[];
  readonly totalRows: number;
  readonly totalInserted: number;
  /** Les lignes qui portent au moins une valeur secrète chiffrée, comparées égales. */
  readonly secretRows: number;
}

export interface MigrationOptions {
  /** Les tables qui existent dans la source (sqlite_master). */
  readonly sourceTables: readonly string[];
  /** Tout lire et contrôler, sans rien écrire. */
  readonly dryRun: boolean;
  /** Une ligne de progression par table. */
  readonly onProgress?: (line: string) => void;
}

export class SqliteToPostgresMigrator {
  private readonly source: ModelReader;
  private readonly target: ModelTarget;
  private readonly models: readonly ModelInfo[];
  private readonly batchSize: number;

  constructor(source: ModelReader, target: ModelTarget, models: readonly ModelInfo[], batchSize: number = MIGRATION_BATCH_SIZE) {
    this.source = source;
    this.target = target;
    this.models = models;
    this.batchSize = batchSize;
  }

  /** La migration complète : contrôle de toute la source, copie, puis vérification ligne à ligne. */
  async run(options: MigrationOptions): Promise<MigrationReport> {
    const present = new Set(options.sourceTables);
    const skippedTables = options.sourceTables.filter((table) => !this.models.some((model) => model.table === table));
    const absentTables = this.models.filter((model) => !present.has(model.table)).map((model) => model.table);
    const planned = orderModels(this.models.filter((model) => present.has(model.table)));

    // 1. Toute la source est lue et contrôlée avant la première écriture.
    let totalRows = 0;
    let secretRows = 0;
    for (const info of planned) {
      const counts = await this.migratorOf(info).scan();
      totalRows += counts.rows;
      secretRows += counts.secrets;
      options.onProgress?.(`contrôle  ${info.table} : ${counts.rows} ligne(s)`);
    }
    if (options.dryRun) {
      return { skippedTables, absentTables, controlledTables: planned.length, tables: [], totalRows, totalInserted: 0, secretRows };
    }

    // 2. La copie, les référencés d'abord.
    const tables: TableReport[] = [];
    for (const info of planned) {
      const counts = await this.migratorOf(info).copy();
      tables.push({ model: info.name, table: info.table, sourceRows: counts.rows, inserted: counts.inserted, batches: counts.batches, secrets: counts.secrets });
      options.onProgress?.(`copie    ${info.table} : ${counts.inserted} ligne(s) écrite(s) sur ${counts.rows}, en ${counts.batches} lot(s)`);
    }

    // 3. La vérification : chaque ligne relue des deux côtés, toutes colonnes comparées.
    for (const [index, info] of planned.entries()) {
      const verified = await this.migratorOf(info).verify();
      if (verified.rows !== tables[index]?.sourceRows) {
        throw new Error(`La source a changé pendant la migration (${info.table} : ${tables[index]?.sourceRows} lignes contrôlées, ${verified.rows} relues). Arrête le bot qui l'écrit, puis relance la migration.`);
      }
      options.onProgress?.(`vérifiée ${info.table} : ${verified.rows} ligne(s) identique(s)`);
    }
    return {
      skippedTables,
      absentTables,
      controlledTables: planned.length,
      tables,
      totalRows,
      totalInserted: tables.reduce((sum, table) => sum + table.inserted, 0),
      secretRows,
    };
  }

  private migratorOf(info: ModelInfo): ModelMigrator {
    return new ModelMigrator(this.source, this.target, info, this.batchSize);
  }
}
