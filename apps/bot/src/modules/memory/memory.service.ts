import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import type { BotTool } from '@10cordes/shared';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';

const MAX_ENTRIES = 200;

/**
 * Mémoire persistante de l'agent (append-only) :
 * - par serveur : faits, règles, présentation, préférences ;
 * - par membre : préférences et notes individuelles.
 * Les corrections se font par un NOUVEL ajout, jamais par suppression.
 */
@Injectable()
export class MemoryService implements SpraxiumOnBoot {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
  ) {}

  async onBoot(): Promise<void> {
    for (const tool of this.buildTools()) this.registry.register(tool);
  }

  async addGuild(guildId: string, content: string, kind: string): Promise<void> {
    await this.prisma.guildMemory.create({ data: { guildId, kind, content } });
    // Garde-fou volume : supprime les plus anciennes au-delà de la limite.
    const extras = await this.prisma.guildMemory.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
      skip: MAX_ENTRIES,
      select: { id: true },
    });
    if (extras.length > 0) {
      await this.prisma.guildMemory.deleteMany({ where: { id: { in: extras.map((e) => e.id) } } });
    }
  }

  async addMember(guildId: string, userId: string, content: string, kind: string): Promise<void> {
    await this.prisma.memberMemory.create({ data: { guildId, userId, kind, content } });
    const extras = await this.prisma.memberMemory.findMany({
      where: { guildId, userId },
      orderBy: { createdAt: 'desc' },
      skip: MAX_ENTRIES,
      select: { id: true },
    });
    if (extras.length > 0) {
      await this.prisma.memberMemory.deleteMany({ where: { id: { in: extras.map((e) => e.id) } } });
    }
  }

  async listGuild(guildId: string, limit = 25): Promise<string[]> {
    const rows = await this.prisma.guildMemory.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
    return rows.map((row) => `[${row.kind}] ${row.content}`);
  }

  async listMember(guildId: string, userId: string, limit = 15): Promise<string[]> {
    const rows = await this.prisma.memberMemory.findMany({
      where: { guildId, userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
    });
    return rows.map((row) => `[${row.kind}] ${row.content}`);
  }

  private buildTools(): BotTool[] {
    const guildOnly = (ctx: { guildId: string | null }): ctx is { guildId: string } & typeof ctx =>
      ctx.guildId !== null;

    return [
      {
        name: 'memory.guild.add',
        description: 'Ajoute un fait durable sur le serveur (règle, présentation, préférence). Append-only.',
        category: 'memory',
        paramsSchema: z.object({
          content: z.string().min(3).max(500),
          kind: z.enum(['fact', 'rule', 'presentation', 'preference']).default('fact'),
        }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt:
          'Sauvegarde spontanément les infos durables apprises sur le serveur (hiérarchie, règles, habitudes, projets). Une correction = un NOUVEL ajout, jamais une suppression.',
        handler: async (input, ctx) => {
          if (!guildOnly(ctx)) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { content, kind } = input as { content: string; kind?: string };
          await this.addGuild(ctx.guildId, content, kind ?? 'fact');
          return { ok: true, summary: `Mémorisé (serveur, ${kind ?? 'fact'}) : ${content.slice(0, 120)}` };
        },
      },
      {
        name: 'memory.guild.get',
        description: 'Lit les derniers souvenirs du serveur (faits, règles, présentation).',
        category: 'memory',
        paramsSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt:
          'Call FIRST quand on demande de présenter le serveur, ou avant toute décision qui devrait respecter les règles mémorisées.',
        handler: async (input, ctx) => {
          if (!guildOnly(ctx)) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { limit } = input as { limit?: number };
          const memories = await this.listGuild(ctx.guildId, limit ?? 20);
          return {
            ok: true,
            summary: memories.length > 0 ? memories.join(' | ') : 'Aucun souvenir serveur pour le moment.',
            data: { memories },
          };
        },
      },
      {
        name: 'memory.member.add',
        description: 'Ajoute un souvenir durable sur un membre (préférence, note, anecdote). Append-only.',
        category: 'memory',
        paramsSchema: z.object({
          userId: z.string().min(1),
          content: z.string().min(3).max(500),
          kind: z.enum(['fact', 'preference', 'note']).default('fact'),
        }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt:
          'Enregistre spontanément les infos personnelles durables que les membres partagent (préférences, projets, in-jokes).',
        handler: async (input, ctx) => {
          if (!guildOnly(ctx)) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { userId, content, kind } = input as { userId: string; content: string; kind?: string };
          await this.addMember(ctx.guildId, userId, content, kind ?? 'fact');
          return { ok: true, summary: `Mémorisé (<@${userId}>, ${kind ?? 'fact'}) : ${content.slice(0, 120)}` };
        },
      },
      {
        name: 'memory.member.get',
        description: 'Lit les derniers souvenirs d\'un membre précis (par ID).',
        category: 'memory',
        paramsSchema: z.object({
          userId: z.string().min(1),
          limit: z.number().int().min(1).max(30).default(10),
        }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt:
          'Call quand tu parles d\'un membre précis : hiérarchie, préférences et anecdotes mémorisées guident ton ton et tes décisions.',
        handler: async (input, ctx) => {
          if (!guildOnly(ctx)) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { userId, limit } = input as { userId: string; limit?: number };
          const memories = await this.listMember(ctx.guildId, userId, limit ?? 10);
          return {
            ok: true,
            summary: memories.length > 0 ? `<@${userId}> : ${memories.join(' | ')}` : `Aucun souvenir sur <@${userId}>.`,
            data: { memories },
          };
        },
      },
    ];
  }
}
