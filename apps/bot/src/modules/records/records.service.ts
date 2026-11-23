import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { PrismaService } from '../database/prisma.service';
import { registerComponentAction } from '../../shared/actions/registry';
import { COLLECTIONS, getCollection } from './collections';

/**
 * Store générique typé : les enregistrements vivent dans AgentRecord
 * (collection + JSON versionné) et sont validés par le registre Zod des
 * collections. L'agent ne peut écrire que dans les collections déclarées
 * EN CODE — refus actionnable listant les champs attendus sinon.
 */
@Injectable()
export class RecordsService implements SpraxiumOnBoot {
  private readonly log = new Logger('Records');

  constructor(private readonly prisma: PrismaService) {}

  onBoot(): void {
    const tools = this.buildTools();
    for (const tool of tools) getToolRegistry().register(tool);
    this.log.info(`${tools.length} tools records enregistrés (${Object.keys(COLLECTIONS).length} collections).`);
    // Executor 'counter' : incrémente un compteur nommé de la collection
    // 'counters' (un enregistrement par nom et par serveur). Enfin branché :
    // le schéma partagé proposait l'action, aucun executor n'existait.
    registerComponentAction('counter', async (action, ctx) => {
      if (action.type !== 'counter') return 'Action inattendue.';
      if (!ctx.guildId) return 'Contexte de serveur requis.';
      const rows = await this.prisma.agentRecord.findMany({
        where: { guildId: ctx.guildId, collection: 'counters' },
      });
      const existing = rows.find((row) => {
        try {
          return (JSON.parse(row.data) as { name?: string }).name === action.name;
        } catch {
          return false;
        }
      });
      if (existing) {
        const current = JSON.parse(existing.data) as { value?: number };
        const value = (current.value ?? 0) + 1;
        await this.prisma.agentRecord.update({
          where: { id: existing.id },
          data: { data: JSON.stringify({ version: 1, name: action.name, value }) },
        });
        return `**${action.name}** : ${value}.`;
      }
      await this.prisma.agentRecord.create({
        data: {
          guildId: ctx.guildId,
          collection: 'counters',
          channelId: ctx.channelId,
          messageId: ctx.messageId,
          createdBy: ctx.userId ?? ctx.member?.id ?? 'anonyme',
          data: JSON.stringify({ version: 1, name: action.name, value: 1 }),
        },
      });
      return `**${action.name}** : 1.`;
    });
  }

  private validate(collection: string, data: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; summary: string } {
    const def = getCollection(collection);
    if (!def) {
      return {
        ok: false,
        summary: `Collection « ${collection} » inconnue. Collections disponibles : ${Object.keys(COLLECTIONS).join(', ')}.`,
      };
    }
    const parsed = def.schema.safeParse(data);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'racine'} : ${issue.message}`).join(' ; ');
      return {
        ok: false,
        summary: `Données invalides pour la collection « ${collection} ». Détail : ${issues}`,
      };
    }
    return { ok: true, data: parsed.data as Record<string, unknown> };
  }

  private buildTools(): BotTool[] {
    return [
      {
        name: 'records.collections',
        description: 'Liste les collections disponibles du store et leurs champs attendus.',
        category: 'records',
        paramsSchema: z.object({}),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Read-only. Consulte AVANT records.create si tu hésites sur les champs.',
        handler: async () => {
          const lines = Object.values(COLLECTIONS).map((def) => `**${def.name}** : ${def.description}`);
          return { ok: true, summary: `Collections : ${lines.join(' | ')}` };
        },
      },
      {
        name: 'records.create',
        description: 'Crée un enregistrement dans une collection typée (validation Zod stricte).',
        category: 'records',
        paramsSchema: z.object({
          collection: z.string().min(1),
          data: z.record(z.string(), z.unknown()),
        }),
        requiredModules: [],
        destructive: false,
        systemPrompt:
          'La validation est stricte : en cas de refus, lis les champs attendus dans le message d\u0027erreur et corrige. Exemples : reminders { userId, text, dueAtIso } ; suggestions { userId, text, status, reason } ; faq { question, answer } ; quotes { text, author } ; counters { name, value } ; notes { targetUserId, content }.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { collection, data } = input as { collection: string; data: unknown };
          const check = this.validate(collection, data);
          if (!check.ok) return check;
          const created = await this.prisma.agentRecord.create({
            data: {
              guildId: ctx.guildId,
              collection,
              data: JSON.stringify({ version: 1, ...check.data }),
              createdBy: ctx.userId,
            },
          });
          return { ok: true, summary: `Enregistrement créé dans « ${collection} » (id ${created.id.slice(-6)}).`, data: { recordId: created.id } };
        },
      },
      {
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
          const { recordId, data: patch } = input as { recordId: string; data: Record<string, unknown> };
          const record = await this.prisma.agentRecord.findFirst({ where: { id: recordId, guildId: ctx.guildId } });
          if (!record) return { ok: false, summary: 'Enregistrement introuvable.' };
          let current: Record<string, unknown>;
          try {
            current = JSON.parse(record.data || '{}') as Record<string, unknown>;
          } catch {
            current = {};
          }
          const merged = { ...current, ...patch };
          const check = this.validate(record.collection, merged);
          if (!check.ok) return check;
          await this.prisma.agentRecord.update({
            where: { id: record.id },
            data: { data: JSON.stringify({ version: 1, ...check.data }) },
          });
          return { ok: true, summary: `Enregistrement ${recordId.slice(-6)} mis à jour.` };
        },
      },
      {
        name: 'records.get',
        description: 'Lit un enregistrement par son id.',
        category: 'records',
        paramsSchema: z.object({ recordId: z.string().min(1) }),
        requiredModules: [],
        destructive: false,
        systemPrompt: 'Read-only. Renvoie les données JSON validées.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { recordId } = input as { recordId: string };
          const record = await this.prisma.agentRecord.findFirst({ where: { id: recordId, guildId: ctx.guildId } });
          if (!record) return { ok: false, summary: 'Enregistrement introuvable.' };
          return { ok: true, summary: `« ${record.collection} » : ${record.data}` };
        },
      },
      {
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
          const { collection, limit } = input as { collection: string; limit?: number };
          const rows = await this.prisma.agentRecord.findMany({
            where: { guildId: ctx.guildId, collection },
            orderBy: { createdAt: 'desc' },
            take: limit ?? 10,
          });
          if (rows.length === 0) return { ok: true, summary: `Aucun enregistrement dans « ${collection} ».` };
          const lines = rows.map((row) => `${row.id.slice(-6)} : ${row.data.slice(0, 140)}`);
          return { ok: true, summary: `${rows.length} enregistrement(s) « ${collection} » : ${lines.join(' | ')}` };
        },
      },
      {
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
          const { collection, query } = input as { collection: string; query: string };
          const rows = await this.prisma.agentRecord.findMany({
            where: { guildId: ctx.guildId, collection, data: { contains: query } },
            orderBy: { createdAt: 'desc' },
            take: 10,
          });
          if (rows.length === 0) return { ok: true, summary: `Aucun résultat pour « ${query} » dans « ${collection} ».` };
          const lines = rows.map((row) => `${row.id.slice(-6)} : ${row.data.slice(0, 140)}`);
          return { ok: true, summary: `${rows.length} résultat(s) : ${lines.join(' | ')}` };
        },
      },
      {
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
          const { recordId } = input as { recordId: string };
          const deleted = await this.prisma.agentRecord.deleteMany({ where: { id: recordId, guildId: ctx.guildId } });
          return deleted.count > 0
            ? { ok: true, summary: 'Enregistrement supprimé.' }
            : { ok: false, summary: 'Enregistrement introuvable.' };
        },
      },
    ];
  }
}
