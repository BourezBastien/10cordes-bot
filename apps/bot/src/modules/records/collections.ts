import { z } from 'zod';
import { DYNAMIC_COLLECTION_NAME_PATTERN } from '../../core/security/collection-quota.policy';

/**
 * Registre des collections NATIVES du store générique : UNE collection = UN
 * schéma Zod déclaré EN CODE, validé à l'écriture ET à la lecture (refus
 * actionnable listant les champs attendus).
 *
 * Le store accepte en plus des collections DYNAMIQUES, créées à la demande
 * sous un nom validé et un contenu borné (voir DynamicRecordDataSchema) :
 * c'est ce qui permet aux recettes de la bibliothèque d'écrire dans
 * casino_balance, giveaway_entries, etc. sans schéma en code par recette.
 */

export interface CollectionDef {
  name: string;
  description: string;
  schema: z.ZodType;
  /** Collection créée à la demande (contenu borné) plutôt que native (schéma strict). */
  dynamic?: boolean;
}

export const COLLECTIONS: Record<string, CollectionDef> = {
  reminders: {
    name: 'reminders',
    description: 'Rappels : { userId, text, dueAtIso } : le texte, le membre concerné et la date ISO.',
    schema: z.object({
      userId: z.string().min(15),
      text: z.string().min(1).max(300),
      dueAtIso: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'date ISO invalide'),
    }),
  },
  suggestions: {
    name: 'suggestions',
    description: 'Suggestions membres : { userId, text, status: PENDING|APPROVED|REJECTED, reason? } : le statut est tranché par le staff.',
    schema: z.object({
      userId: z.string().min(15),
      text: z.string().min(1).max(500),
      status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
      reason: z.string().max(300).optional(),
    }),
  },
  quotes: {
    name: 'quotes',
    description: 'Citations du serveur : { text, author }.',
    schema: z.object({
      text: z.string().min(1).max(400),
      author: z.string().min(1).max(80),
    }),
  },
  faq: {
    name: 'faq',
    description: 'FAQ : { question, answer }.',
    schema: z.object({
      question: z.string().min(3).max(200),
      answer: z.string().min(1).max(1000),
    }),
  },
  counters: {
    name: 'counters',
    description: 'Compteurs nommés : { name, value } : incrémentés par les boutons counter des panels.',
    schema: z.object({
      name: z.string().min(1).max(60),
      value: z.number().int().min(0),
    }),
  },
  notes: {
    name: 'notes',
    description: 'Notes staff sur un membre : { targetUserId, content } : réservé au staff à la lecture.',
    schema: z.object({
      targetUserId: z.string().min(15),
      content: z.string().min(1).max(500),
    }),
  },
  component_votes: {
    name: 'component_votes',
    description:
      'Votes de composants (sondages, RSVP, inscriptions) : { messageId, channelId, choice }, un vote par membre par message, modifiable. Dépouillement par records.search (filtre messageId) puis affichage via surface.updateComponent (description).',
    schema: z.object({
      messageId: z.string().min(1),
      channelId: z.string().min(1),
      choice: z.string().min(1).max(80),
    }),
  },
};

export function collectionNames(): string[] {
  return Object.keys(COLLECTIONS);
}

export function getCollection(name: string): CollectionDef | null {
  return COLLECTIONS[name] ?? null;
}

// ── Collections dynamiques (décision du 23/11 : store extensible) ──────────
//
// Les recettes de la bibliothèque écrivent dans des collections qui n'existent
// pas dans le registre natif (casino_balance, giveaway_entries, streaks...).
// Elles sont acceptées à la demande, sous un nom validé par
// CollectionQuotaPolicy et un CONTENU borné : pas de schéma libre sans limites.

/** Longueur maximale d'une clé. */
const DYNAMIC_MAX_KEY_LENGTH = 64;
/** Nombre maximal d'éléments d'une liste. */
const DYNAMIC_MAX_LIST_LENGTH = 50;
/** Nombre total maximal de clés, tous niveaux confondus. */
const DYNAMIC_MAX_TOTAL_KEYS = 100;
/** Taille maximale du document sérialisé. */
const DYNAMIC_MAX_SERIALIZED_CHARS = 4000;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const scalarValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
/** Valeur d'un document dynamique : scalaire, liste de scalaires ou objet de scalaires. */
const dynamicValue = z.union([
  scalarValue,
  z.array(scalarValue).max(DYNAMIC_MAX_LIST_LENGTH),
  z.record(z.string().min(1).max(DYNAMIC_MAX_KEY_LENGTH), scalarValue),
]);

/** Compte les clés d'un document et relève les clés dangereuses (pollution de prototype). */
function scanDocument(value: unknown, counter: { keys: number; unsafe: string[] }): void {
  if (Array.isArray(value)) {
    for (const item of value) scanDocument(item, counter);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    counter.keys += 1;
    if (DANGEROUS_KEYS.has(key)) counter.unsafe.push(key);
    scanDocument(inner, counter);
  }
}

/** Clés interdites rencontrées dans un document, à quelque profondeur que ce soit. */
export function findUnsafeKeys(value: unknown): string[] {
  const counter: { keys: number; unsafe: string[] } = { keys: 0, unsafe: [] };
  scanDocument(value, counter);
  return counter.unsafe;
}

/** Document dans les bornes de taille (clés et caractères sérialisés). */
export function isBoundedDocument(value: unknown): boolean {
  const counter: { keys: number; unsafe: string[] } = { keys: 0, unsafe: [] };
  scanDocument(value, counter);
  if (counter.keys > DYNAMIC_MAX_TOTAL_KEYS) return false;
  try {
    return JSON.stringify(value).length <= DYNAMIC_MAX_SERIALIZED_CHARS;
  } catch {
    return false;
  }
}

/**
 * Schéma d'une collection dynamique : objet JSON borné (clés de 64 caractères,
 * valeurs scalaires, listes ou objets de scalaires). Les bornes de taille et
 * les clés interdites sont aussi vérifiées sur l'entrée brute par
 * RecordsService, indépendamment de la reconstruction faite par Zod.
 */
export const DynamicRecordDataSchema = z.record(z.string().min(1).max(DYNAMIC_MAX_KEY_LENGTH), dynamicValue);

export const DYNAMIC_COLLECTION_TOO_LARGE =
  'Données refusées : 100 clés et 4 000 caractères sérialisés au maximum pour une collection dynamique';

export const DYNAMIC_COLLECTION_DESCRIPTION =
  'Collection dynamique créée à la demande : objet JSON borné (clés de 64 caractères, valeurs scalaires, listes ou objets de scalaires, 100 clés et 4 000 caractères au total).';

/** Définition d'une collection dynamique (le nom est déjà validé par la policy). */
export function dynamicCollection(name: string): CollectionDef {
  return { name, description: DYNAMIC_COLLECTION_DESCRIPTION, schema: DynamicRecordDataSchema, dynamic: true };
}

/** Définition d'une collection : native (schéma strict) ou dynamique (contenu borné). */
export function resolveCollection(name: string): CollectionDef | null {
  return COLLECTIONS[name] ?? (DYNAMIC_COLLECTION_NAME_PATTERN.test(name) ? dynamicCollection(name) : null);
}
