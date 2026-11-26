import { afterKey, keyOf, keyText, orderByKey, whereKeys } from './migration-plan.ts';
import type { ModelPort, ModelReader, ModelTarget, Row } from './migration-ports.ts';
import { assertRow, carriesSecret, valuesEqual } from './row-values.ts';
import type { ModelInfo } from './schema-catalog.ts';

export interface ModelCounts {
  readonly rows: number;
  readonly secrets: number;
}

export interface CopyCounts extends ModelCounts {
  readonly inserted: number;
  readonly batches: number;
}

/** Erreur de vérification : une ligne copiée diffère de sa source, ou manque. */
export class MigrationVerifyError extends Error {
  constructor(detail: string) {
    super(`Vérification de la cible : ${detail}`);
    this.name = 'MigrationVerifyError';
  }
}

/**
 * La migration d'UN modèle : relire la source par lots sur la clé primaire,
 * écrire les lignes manquantes dans la cible, puis relire les deux et les
 * comparer ligne à ligne. La source n'est jamais écrite, la cible n'est jamais
 * corrigée : une ligne déjà présente est laissée telle quelle, et la
 * vérification dit si elle diffère.
 */
export class ModelMigrator {
  private readonly source: ModelPort;
  private readonly target: ModelPort;
  private readonly writer: ModelTarget;
  private readonly info: ModelInfo;
  private readonly size: number;

  constructor(source: ModelReader, target: ModelTarget, info: ModelInfo, batchSize: number) {
    this.source = source.model(info.name);
    this.target = target.model(info.name);
    this.writer = target;
    this.info = info;
    this.size = batchSize;
  }

  /** Relit toute la table de la source en contrôlant chaque valeur : rien n'est écrit. */
  async scan(): Promise<ModelCounts> {
    let rows = 0;
    let secrets = 0;
    for await (const batch of this.batches()) {
      rows += batch.length;
      secrets += batch.filter((row) => carriesSecret(this.info, row)).length;
    }
    return { rows, secrets };
  }

  /** Écrit les lignes que la cible n'a pas encore ; celles qui y sont déjà ne sont pas reprises. */
  async copy(): Promise<CopyCounts> {
    let rows = 0;
    let secrets = 0;
    let inserted = 0;
    let batches = 0;
    for await (const batch of this.batches()) {
      rows += batch.length;
      secrets += batch.filter((row) => carriesSecret(this.info, row)).length;
      const written = await this.writer.writable(this.info.name).createMany({ data: batch, skipDuplicates: true });
      inserted += written.count;
      batches += 1;
    }
    return { rows, secrets, inserted, batches };
  }

  /** Relit la source et la cible : chaque ligne de la source est dans la cible, toutes colonnes égales. */
  async verify(): Promise<ModelCounts> {
    let rows = 0;
    let secrets = 0;
    for await (const batch of this.batches()) {
      const keys = batch.map((row) => keyOf(this.info, row));
      const found = new Map((await this.target.findMany({ where: whereKeys(this.info, keys) })).map((row) => [keyText(this.info, row), row]));
      for (const row of batch) {
        const key = keyText(this.info, row);
        const other = found.get(key);
        if (other === undefined) throw new MigrationVerifyError(`${this.info.table} : la ligne de clé ${key} manque dans la cible.`);
        for (const field of this.info.fields) {
          if (!valuesEqual(row[field.name], other[field.name])) throw new MigrationVerifyError(`${this.info.table}.${field.name} : la valeur diffère entre la source et la cible (ligne de clé ${key}).`);
        }
        rows += 1;
        if (carriesSecret(this.info, row)) secrets += 1;
      }
    }
    const count = await this.writer.writable(this.info.name).count();
    if (count < rows) throw new MigrationVerifyError(`${this.info.table} : la cible compte ${count} lignes pour ${rows} lues dans la source.`);
    return { rows, secrets };
  }

  /** Les lignes de la source par lots, sur la clé primaire, chaque valeur contrôlée. */
  private async *batches(): AsyncGenerator<Row[]> {
    let after: Row | null = null;
    for (;;) {
      const rows = await this.source.findMany({ where: after === null ? undefined : afterKey(this.info, after), orderBy: orderByKey(this.info), take: this.size });
      for (const row of rows) assertRow(this.info, row, this.info.table);
      if (rows.length === 0) return;
      yield rows;
      if (rows.length < this.size) return;
      after = keyOf(this.info, rows[rows.length - 1] as Row);
    }
  }
}
