import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { PrismaService } from '../database/prisma.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';

/**
 * Optimisation des coûts provider : cache de réponses pour les questions
 * répétées. Une même question (contenu normalisé) dans le même serveur
 * renvoie la réponse cachée au lieu d'un nouvel appel LLM. TTL 30 min,
 * purge automatique. Les actions (tools) ne sont jamais cachées : cache
 * réservé aux réponses conversationnelles pures.
 */

const CACHE_TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 200;

export function cacheKey(guildId: string, content: string): string {
  const normalized = content.toLowerCase().replace(/\s+/gu, ' ').trim();
  return createHash('sha256').update(`${guildId}:${normalized}`).digest('hex').slice(0, 32);
}

@Injectable()
export class ResponseCacheService implements SpraxiumOnBoot {
  private readonly log = new Logger('ResponseCache');
  private readonly cache = new Map<string, { reply: string; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistryService,
  ) {}

  onBoot(): void {
    const tool: BotTool = {
      name: 'getCachedAnswer',
      description:
        'Retourne la réponse en cache pour cette question exacte si elle existe (moins de 30 minutes), sinon rien. L\u0027appelant du chat la consulte automatiquement : ce tool est réservé au diagnostic.',
      category: 'agent',
      paramsSchema: z.object({ content: z.string().min(1).max(500) }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Diagnostic uniquement.',
      handler: async (input, ctx) => {
        const { content } = input as { content: string };
        const reply = ctx.guildId ? this.get(ctx.guildId, content) : null;
        return reply
          ? { ok: true, summary: 'Réponse en cache trouvée.', data: { reply } }
          : { ok: false, summary: 'Pas de cache pour cette question.' };
      },
    };
    this.registry.register(tool);
  }

  get(guildId: string, content: string): string | null {
    const key = cacheKey(guildId, content);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.at > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    // LRU : rafraîchit la position.
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.reply;
  }

  put(guildId: string, content: string, reply: string): void {
    if (reply.length > 1500) return; // Les réponses longues restent dynamiques.
    if (this.cache.size >= MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(cacheKey(guildId, content), { reply, at: Date.now() });
  }
}
