import { z } from 'zod';

/**
 * Registre des collections du store générique : UNE collection = UN schéma
 * Zod déclaré EN CODE. L'agent ne peut créer des enregistrements que dans
 * ces collections (validation à l'écriture ET à la lecture, refus
 * actionnable listant les champs attendus). Pas de schéma libre sans type :
 * une nouvelle collection = un nouveau schéma ici, jamais du JSON nu.
 */

export interface CollectionDef {
  name: string;
  description: string;
  schema: z.ZodType;
}

export const COLLECTIONS: Record<string, CollectionDef> = {
  reminders: {
    name: 'reminders',
    description: 'Rappels : { userId, text, dueAtIso } — le texte, le membre concerné et la date ISO.',
    schema: z.object({
      userId: z.string().min(15),
      text: z.string().min(1).max(300),
      dueAtIso: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'date ISO invalide'),
    }),
  },
  suggestions: {
    name: 'suggestions',
    description: 'Suggestions membres : { userId, text, status: PENDING|APPROVED|REJECTED, reason? } — le statut est tranché par le staff.',
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
    description: 'Compteurs nommés : { name, value } — incrémentés par les boutons counter des panels.',
    schema: z.object({
      name: z.string().min(1).max(60),
      value: z.number().int().min(0),
    }),
  },
  notes: {
    name: 'notes',
    description: 'Notes staff sur un membre : { targetUserId, content } — réservé au staff à la lecture.',
    schema: z.object({
      targetUserId: z.string().min(15),
      content: z.string().min(1).max(500),
    }),
  },
};

export function collectionNames(): string[] {
  return Object.keys(COLLECTIONS);
}

export function getCollection(name: string): CollectionDef | null {
  return COLLECTIONS[name] ?? null;
}
