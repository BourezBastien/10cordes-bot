import type { ToolRunContext } from '@10cordes/shared';
import type { PrismaService } from '../database/prisma.service';

const NODES_TTL_MS = 30_000;

interface CachedNodes {
  nodes: ToolNode[];
  fetchedAt: number;
}

/** Override staff : { cible (utilisateur ou rôle) × tool × effet allow/deny }. */
export interface ToolNode {
  targetId: string;
  tool: string;
  effect: string;
}

/**
 * RBAC par nœuds du serveur : les overrides posés par le staff (tool.setNode).
 * Un nœud couvre l'appelant quand il vise son id ou l'un de ses rôles. Les
 * nœuds d'un serveur sont mis en cache 30 s (invalidés après node.set/remove).
 */
export class ToolNodePolicy {
  private readonly cache = new Map<string, CachedNodes>();

  constructor(private readonly prisma: PrismaService) {}

  /** Invalide le cache des nœuds d'un serveur (après node.set/remove). */
  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  /** Un nœud DENY couvre-t-il ce tool pour l'appelant (utilisateur ou rôle) ? */
  async denies(guildId: string | null, toolName: string, ctx: ToolRunContext): Promise<boolean> {
    return this.hasNode(guildId, toolName, 'deny', ctx);
  }

  /** Un nœud ALLOW couvre-t-il ce tool pour l'appelant (utilisateur ou rôle) ? */
  async allows(guildId: string | null, toolName: string, ctx: ToolRunContext): Promise<boolean> {
    return this.hasNode(guildId, toolName, 'allow', ctx);
  }

  private async hasNode(guildId: string | null, toolName: string, effect: string, ctx: ToolRunContext): Promise<boolean> {
    if (!guildId) return false;
    const nodes = await this.nodesFor(guildId);
    return nodes.some((node) => node.tool === toolName && node.effect === effect && this.covers(node, ctx));
  }

  /** Le nœud vise-t-il l'appelant (son id ou l'un de ses rôles) ? */
  private covers(node: ToolNode, ctx: ToolRunContext): boolean {
    return node.targetId === ctx.userId || (ctx.roleIds ?? []).includes(node.targetId);
  }

  private async nodesFor(guildId: string): Promise<ToolNode[]> {
    const cached = this.cache.get(guildId);
    if (cached && Date.now() - cached.fetchedAt < NODES_TTL_MS) return cached.nodes;
    const rows = await this.prisma.toolNode.findMany({
      where: { guildId },
      select: { targetId: true, tool: true, effect: true },
    });
    this.cache.set(guildId, { nodes: rows, fetchedAt: Date.now() });
    return rows;
  }
}
