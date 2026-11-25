import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import type { BotTool } from '@10cordes/shared';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { permissionNamesPolicy } from '../../core/security/permission-names.policy';
import { MemoryCuratorService, type ConsolidationResult } from './memory-curator.service';
import { CORRECTIONS_MAX, correctionLine } from './memory-correction.matcher';

const MAX_ENTRIES = 200;

/**
 * Mémoire persistante de l'agent :
 * - JOURNAL brut append-only (GuildMemory / MemberMemory) : traçabilité
 *   complète, visible dans le dashboard ;
 * - FICHES consolidées (MemberMemoryProfile / GuildMemoryProfile) : fusion
 *   LLM avec gardes budget/anti-wipe/attribution (MemoryCuratorService),
 *   ce sont elles qui sont injectées dans le prompt de l'agent.
 */
@Injectable()
export class MemoryService implements SpraxiumOnBoot {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
    private readonly curator: MemoryCuratorService,
  ) {}

  async onBoot(): Promise<void> {
    for (const tool of this.buildTools()) this.registry.register(tool);
    this.registry.register(this.forgetTool());
  }

  /** R0.5 : le membre a-t-il demandé à être oublié (opt-out persistant) ? */
  async hasOptedOut(guildId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.memoryOptOut.findFirst({ where: { userId, guildId } }).catch(() => null);
    return row !== null;
  }

  /** R0.5 : purge complète + opt-out. Retourne le décompte supprimé (les corrections du membre partent aussi). */
  async forgetMember(guildId: string, userId: string): Promise<{ entries: number; profiles: number }> {
    const entries = await this.prisma.memberMemory.deleteMany({ where: { guildId, userId } });
    const corrections = await this.prisma.memoryCorrection.deleteMany({ where: { guildId, userId } }).catch(() => ({ count: 0 }));
    const profiles = await this.prisma.memberMemoryProfile.deleteMany({ where: { guildId, userId } }).catch(() => ({ count: 0 }));
    await this.prisma.memoryOptOut.upsert({
      where: { userId_guildId: { userId, guildId } },
      create: { userId, guildId },
      update: {},
    }).catch(() => {
      /* contrainte composite éventuelle : id simple */
    });
    return { entries: entries.count + corrections.count, profiles: profiles.count };
  }

  private forgetTool(): BotTool {
    return {
      name: 'memory.forget',
      description:
        "Oublie TOTALEMENT un membre : purge son journal mémoire et sa fiche consolidée, puis pose un opt-out durable (plus rien ne sera enregistré sur lui tant qu'il ne change pas d'avis). Réponds ensuite en une phrase de confirmation, sans dramatiser.",
      category: 'memory',
      paramsSchema: z.object({
        userId: z.string().min(15).optional().describe('Par défaut : le demandeur lui-même'),
      }),
      requiredModules: [],
      permissions: [],
      destructive: true,
      systemPrompt:
        "À appeler dès qu'un membre demande en langage naturel « oublie-moi », « efface mes données », « arrête de me mémoriser » : pour LUI-MÊME par défaut (userId omis = demandeur). Purger un AUTRE membre exige la permission ManageGuild (registry). Confirme ensuite simplement.",
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { userId } = (input ?? {}) as { userId?: string };
        const target = userId ?? ctx.userId;
        const isSelf = target === ctx.userId;
        if (!isSelf && !permissionNamesPolicy.hasAny(ctx.permissions, ['ManageGuild', 'Administrator'])) {
          return { ok: false, summary: 'Purger la mémoire d\u0027un autre membre requiert ManageGuild.' };
        }
        const counts = await this.forgetMember(ctx.guildId, target);
        return {
          ok: true,
          summary: `Mémoire de <@${target}> purgée (${counts.entries} entrées, ${counts.profiles} fiche(s)) et opt-out actif : plus rien ne sera retenu sur lui.`,
        };
      },
    };
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
    // R0.5 opt-out : le membre a demandé à être oublié → plus aucune écriture.
    if (await this.hasOptedOut(guildId, userId)) return;
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

  /** Fiche consolidée du serveur (injectée dans le prompt, compacte). */
  async getGuildProfile(guildId: string): Promise<string | null> {
    return this.curator.getGuildProfile(guildId);
  }

  /** Fiche consolidée d'un membre (injectée dans le prompt, compacte). */
  async getMemberProfile(guildId: string, userId: string): Promise<string | null> {
    return this.curator.getMemberProfile(guildId, userId);
  }

  /** Entrées du journal encore lisibles : celles qu'une correction n'a pas périmées. */
  async listGuild(guildId: string, limit = 25): Promise<string[]> {
    const rows = await this.prisma.guildMemory.findMany({
      where: { guildId, supersededAt: null },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
    return rows.map((row) => `[${row.kind}] ${row.content}`);
  }

  async listMember(guildId: string, userId: string, limit = 15): Promise<string[]> {
    const rows = await this.prisma.memberMemory.findMany({
      where: { guildId, userId, supersededAt: null },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
    });
    return rows.map((row) => `[${row.kind}] ${row.content}`);
  }

  /** Les corrections actives d'une fiche (le serveur, ou un membre), mises en forme : elles priment sur le journal et sur la fiche. */
  async correctionsOf(guildId: string, userId: string | null): Promise<string[]> {
    const rows = await this.prisma.memoryCorrection
      .findMany({ where: { guildId, userId, supersededAt: null }, orderBy: { createdAt: 'desc' }, take: CORRECTIONS_MAX })
      .catch(() => []);
    return rows.map(correctionLine);
  }

  /** Les corrections à injecter dans le prompt : celles du serveur, et celles des membres lus. */
  async correctionLines(guildId: string, memberIds: readonly string[]): Promise<{ guild: string[]; members: Map<string, string[]> }> {
    const [guild, ...members] = await Promise.all([this.correctionsOf(guildId, null), ...memberIds.map((id) => this.correctionsOf(guildId, id))]);
    return { guild, members: new Map(memberIds.map((id, index) => [id, members[index] ?? []])) };
  }

  private buildTools(): BotTool[] {
    const guildOnly = (ctx: { guildId: string | null }): ctx is { guildId: string } & typeof ctx =>
      ctx.guildId !== null;

    const consolidationSummary = (result: ConsolidationResult): { ok: boolean; extra: string } => {
      switch (result.status) {
        case 'appended':
          return { ok: true, extra: 'Fiche consolidée mise à jour.' };
        case 'rejected':
          return { ok: false, extra: `Refusé par le conservateur : ${result.reason ?? 'fait non retenu'}` };
        default:
          return { ok: true, extra: 'Conservé dans le journal (fusion différée).' };
      }
    };

    return [
      {
        name: 'saveServerMemory',
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
          'Sauvegarde spontanément les infos durables apprises sur le serveur (hiérarchie, règles, habitudes, projets, style). Si le fait en CORRIGE un autre, appelle memory.correct (scope server) : un simple ajout laisserait l\u0027ancien fait.',
        handler: async (input, ctx) => {
          if (!guildOnly(ctx)) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { content, kind } = input as { content: string; kind?: string };
          await this.addGuild(ctx.guildId, content, kind ?? 'fact');
          const result = await this.curator.consolidateGuild(ctx.guildId, ctx.userId, content);
          const { ok, extra } = consolidationSummary(result);
          return {
            ok,
            summary: `Mémorisé (serveur, ${kind ?? 'fact'}) : ${content.slice(0, 120)}. ${extra}`,
          };
        },
      },
      {
        name: 'getServerMemory',
        description: 'Lit la fiche mémoire consolidée du serveur puis les derniers faits bruts.',
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
          const [profile, memories, corrections] = await Promise.all([this.getGuildProfile(ctx.guildId), this.listGuild(ctx.guildId, limit ?? 20), this.correctionsOf(ctx.guildId, null)]);
          const parts: string[] = [];
          if (corrections.length > 0) parts.push(`Faits corrigés (ils priment) : ${corrections.join(' | ')}`);
          if (profile) parts.push(`Fiche consolidée : ${profile}`);
          parts.push(memories.length > 0 ? memories.join(' | ') : 'Aucun souvenir brut.');
          return {
            ok: true,
            summary: parts.join('\n'),
            data: { profile, memories, corrections },
          };
        },
      },
      {
        name: 'saveMemberMemory',
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
          'Enregistre spontanément les infos personnelles durables que les membres partagent (préférences, projets, in-jokes). Si le fait en CORRIGE un autre sur ce membre, appelle memory.correct : un simple ajout laisserait l\u0027ancien fait.',
        handler: async (input, ctx) => {
          if (!guildOnly(ctx)) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { userId, content, kind } = input as { userId: string; content: string; kind?: string };
          await this.addMember(ctx.guildId, userId, content, kind ?? 'fact');
          const result = await this.curator.consolidateMember(ctx.guildId, userId, ctx.userId, content);
          const { ok, extra } = consolidationSummary(result);
          return {
            ok,
            summary: `Mémorisé (<@${userId}>, ${kind ?? 'fact'}) : ${content.slice(0, 120)}. ${extra}`,
          };
        },
      },
      {
        name: 'getMemberMemory',
        description: 'Lit la fiche consolidée d\'un membre précis (par ID) puis ses derniers faits bruts.',
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
          const [profile, memories, corrections] = await Promise.all([
            this.getMemberProfile(ctx.guildId, userId),
            this.listMember(ctx.guildId, userId, limit ?? 10),
            this.correctionsOf(ctx.guildId, userId),
          ]);
          const parts: string[] = [`<@${userId}> :`];
          if (corrections.length > 0) parts.push(`Faits corrigés (ils priment) : ${corrections.join(' | ')}`);
          if (profile) parts.push(`Fiche consolidée : ${profile}`);
          parts.push(memories.length > 0 ? memories.join(' | ') : 'Aucun souvenir brut.');
          return {
            ok: true,
            summary: parts.join('\n'),
            data: { profile, memories, corrections },
          };
        },
      },
    ];
  }
}
