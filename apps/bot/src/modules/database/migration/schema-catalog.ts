/*
 * LECTURE DU SCHÉMA PRISMA par la migration. Un client généré « prisma-client »
 * n'expose pas les métadonnées de ses modèles (plus de `Prisma.dmmf`) : la
 * migration lit donc le schéma dérivé SQLite lui-même, qui décrit la source
 * (prisma/schema.sqlite.prisma). Elle y prend ce dont elle a besoin : le nom
 * du modèle (la propriété du client), sa clé primaire (relire par lots et
 * comparer), ses champs scalaires et leur type (valider les valeurs), et les
 * modèles qu'il référence (les copier après eux).
 *
 * Le fichier est formaté par `prisma format` : un champ par ligne. Une forme
 * inattendue arrête la migration, elle n'est jamais devinée.
 */

export type ScalarType = 'String' | 'Boolean' | 'Int' | 'Float' | 'DateTime';

const SCALARS: readonly string[] = ['String', 'Boolean', 'Int', 'Float', 'DateTime'];

export interface ScalarField {
  readonly name: string;
  readonly type: ScalarType;
  readonly optional: boolean;
}

export interface ModelInfo {
  /** Le nom du modèle : la propriété du client Prisma qui le sert. */
  readonly name: string;
  /** La table en base (`@@map`), ou le nom du modèle. */
  readonly table: string;
  readonly fields: readonly ScalarField[];
  /** Les colonnes de la clé primaire, dans l'ordre. */
  readonly primaryKey: readonly string[];
  /** Les modèles qu'il référence par une relation. */
  readonly references: readonly string[];
}

interface ModelDraft {
  name: string;
  table: string;
  fields: ScalarField[];
  singleKey: string[];
  compositeKey: string[];
  references: string[];
}

const MODEL_OPEN = /^model (\w+) \{$/u;
const FIELD = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/u;
const MAPPED = /^@@map\("(\w+)"\)$/u;
const COMPOSITE_KEY = /^@@id\(\[(\w+(?:\s*,\s*\w+)*)\]\)$/u;
const SIMPLE_KEY = /(?:^|\s)@id(?:\s|$)/u;
// Le nom de la relation peut précéder `fields` : @relation("RoutePrimaryProvider", fields: [providerId], ...).
const OWNS_FOREIGN_KEY = /@relation\([^)]*\bfields:\s*\[/u;

/** Erreur de lecture du schéma : la migration s'arrête, elle ne devine pas. */
export class SchemaReadError extends Error {
  constructor(detail: string) {
    super(`Schéma Prisma illisible par la migration : ${detail}`);
    this.name = 'SchemaReadError';
  }
}

/** Les modèles d'un schéma, dans l'ordre du fichier. */
export function parsePrismaSchema(text: string): ModelInfo[] {
  const models: ModelInfo[] = [];
  let current: ModelDraft | null = null;
  const lines = text.split(/\r?\n/u);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (current === null) {
      const open = line.match(MODEL_OPEN);
      if (open?.[1]) current = { name: open[1], table: open[1], fields: [], singleKey: [], compositeKey: [], references: [] };
      continue;
    }
    const draft: ModelDraft = current;
    if (line === '}') {
      models.push({
        name: draft.name,
        table: draft.table,
        fields: draft.fields,
        primaryKey: draft.singleKey.length > 0 ? draft.singleKey : draft.compositeKey,
        references: draft.references,
      });
      current = null;
      continue;
    }
    if (line === '' || line.startsWith('//')) continue;
    const mapped = line.match(MAPPED);
    if (mapped?.[1]) {
      draft.table = mapped[1];
      continue;
    }
    const composite = line.match(COMPOSITE_KEY);
    if (composite?.[1]) {
      draft.compositeKey = composite[1].split(',').map((name) => name.trim());
      continue;
    }
    if (line.startsWith('@@')) continue;
    const field = line.match(FIELD);
    if (!field?.[1] || !field[2]) throw new SchemaReadError(`ligne ${index + 1} (${draft.name}) : champ illisible.`);
    const name = field[1];
    const type = field[2];
    const attributes = (field[5] ?? '').split('//')[0] ?? '';
    if (field[3] === undefined && SCALARS.includes(type)) {
      draft.fields.push({ name, type: type as ScalarType, optional: field[4] === '?' });
      if (SIMPLE_KEY.test(attributes)) draft.singleKey = [name];
    } else if (OWNS_FOREIGN_KEY.test(attributes)) {
      // Seule la relation qui porte la clé étrangère (`fields: [...]`) oblige à copier sa cible d'abord.
      // Les listes en retour (`auditLogs AuditLog[]`) et les relations nommées sans `fields` n'en portent pas.
      draft.references.push(type);
    }
  }
  if (current !== null) throw new SchemaReadError(`le modèle ${current.name} n'est pas fermé.`);
  for (const model of models) {
    if (model.primaryKey.length === 0) throw new SchemaReadError(`le modèle ${model.name} n'a pas de clé primaire.`);
    for (const column of model.primaryKey) {
      if (!model.fields.some((field) => field.name === column)) throw new SchemaReadError(`la clé primaire de ${model.name} nomme un champ inconnu (${column}).`);
    }
  }
  return models;
}
