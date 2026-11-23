import { z } from 'zod';
import { defineTool, type BotTool } from '@10cordes/shared';
import type { RecordsService } from './records.service';

/**
 * Tools du store générique. Les 7 collections natives ont un schéma strict ;
 * toute autre collection au format dynamique est créée à la demande (contenu
 * borné, quota par serveur appliqué par RecordsService, qui renvoie lui-même
 * les refus).
 */

export function buildRecordTools(service: RecordsService): BotTool[] {
  return [
    defineTool({
      name: 'records.collections',
      description:
        'Liste les collections du store : les 7 collections natives avec leurs champs attendus, et les collections dynamiques déjà ouvertes sur ce serveur. Indique le format de nom pour en créer une nouvelle.',
      category: 'records',
      paramsSchema: z.object({}),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Read-only. Consulte AVANT records.create si tu hésites sur les champs d\u0027une collection native.',
      handler: async (_input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const overview = await service.describeCollections(ctx.guildId);
        const native = overview.native.map((entry) => `**${entry.name}** : ${entry.description}`).join(' | ');
        const dynamic =
          overview.dynamic.length > 0 ? overview.dynamic.map((entry) => `${entry.name} (${entry.records} enr.)`).join(', ') : 'aucune';
        return {
          ok: true,
          summary:
            `Collections natives : ${native}. Collections dynamiques de ce serveur : ${dynamic}. ` +
            'Une collection dynamique s\u0027ouvre toute seule au premier records.create (nom en minuscules, chiffres, _ ou - ; contenu JSON borné).',
        };
      },
    }),
    defineTool({
      name: 'records.create',
      description:
        'Crée un enregistrement dans une collection native (validation stricte des champs) ou dynamique (créée à la demande si elle n\u0027existe pas encore, contenu JSON borné, quota par serveur).',
      category: 'records',
      paramsSchema: z.object({
        collection: z.string().min(1).max(48),
        data: z.record(z.string(), z.unknown()),
      }),
      requiredModules: [],
      destructive: false,
      systemPrompt:
        'La validation est stricte : en cas de refus, lis les champs attendus dans le message d\u0027erreur et corrige. Collections natives : reminders { userId, text, dueAtIso } ; suggestions { userId, text, status, reason } ; faq { question, answer } ; quotes { text, author } ; counters { name, value } ; notes { targetUserId, content } ; component_votes { messageId, channelId, choice }. Pour toute autre collection (solde d\u0027un casino, inscriptions à un tirage...) : nom au format casino_balance, données plates et courtes.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        return service.create(ctx.guildId, ctx.userId, input.collection, input.data);
      },
    }),
    defineTool({
      name: 'records.update',
      description: 'Met à jour les données d\u0027un enregistrement (fusion champ par champ, validation complète après fusion).',
      category: 'records',
      paramsSchema: z.object({
        recordId: z.string().min(1),
        data: z.record(z.string(), z.unknown()).describe('Champs à fusionner'),
      }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Fusion : seuls les champs fournis changent, le reste est conservé puis revalidé en entier.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        return service.update(ctx.guildId, input.recordId, input.data);
      },
    }),
    defineTool({
      name: 'records.get',
      description: 'Lit un enregistrement par son id.',
      category: 'records',
      paramsSchema: z.object({ recordId: z.string().min(1) }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Read-only. Renvoie les données JSON validées.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        return service.get(ctx.guildId, input.recordId);
      },
    }),
    defineTool({
      name: 'records.list',
      description: 'Liste les enregistrements d\u0027une collection (paginé, du plus récent).',
      category: 'records',
      paramsSchema: z.object({
        collection: z.string().min(1),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Read-only. En [PANEL] si liste longue.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        return service.list(ctx.guildId, input.collection, input.limit);
      },
    }),
    defineTool({
      name: 'records.search',
      description: 'Recherche plein-texte simple dans une collection (sous-chaîne dans les données).',
      category: 'records',
      paramsSchema: z.object({
        collection: z.string().min(1),
        query: z.string().min(2).max(100),
      }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Read-only. Recherche en sous-chaîne (insensible à la casse via SQL LIKE).',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        return service.search(ctx.guildId, input.collection, input.query);
      },
    }),
    defineTool({
      name: 'records.delete',
      description: 'Supprime un enregistrement.',
      category: 'records',
      paramsSchema: z.object({ recordId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: true,
      systemPrompt: 'Destructif mais borné : un seul enregistrement.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        return service.remove(ctx.guildId, input.recordId);
      },
    }),
  ];
}
