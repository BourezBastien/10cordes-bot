import type { Guild } from 'discord.js';
import type { BotTool } from '@10cordes/shared';
import { z } from 'zod';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../database/prisma.service';

/**
 * Historique de l'agent dans l'audit : les dernières actions (contexte du
 * prompt) et les instantanés du serveur (base du retour arrière).
 */

/**
 * Tools qui touchent à la structure du serveur : AVANT le premier appel,
 * un instantané complet (catégories, salons, rôles) est archivé en audit
 * (action 'server.snapshot'), la base immuable du retour arrière.
 */
const SNAPSHOT_TOOLS = new Set([
  'deleteChannel',
  'renameChannel',
  'moveChannel',
  'setChannelTopic',
  'setChannelSlowmode',
  'setChannelOverwrite',
  'archiveChannel',
  'deleteRole',
  'renameRole',
  'setRoleColor',
  'banMember',
  'kickMember',
]);

/** Ce tool modifie-t-il la structure du serveur (instantané requis avant exécution) ? */
export function requiresServerSnapshot(toolName: string): boolean {
  return SNAPSHOT_TOOLS.has(toolName);
}

/** Photographie complète et sérialisable de la structure d'un serveur. */
export function captureServerSnapshot(guild: Guild) {
  return {
    at: new Date().toISOString(),
    categories: [...guild.channels.cache.values()]
      .filter((c) => !c.isThread() && c.type === 4)
      .map((c) => ({ id: c.id, name: c.name, position: (c as import('discord.js').GuildChannel).rawPosition })),
    channels: [...guild.channels.cache.values()]
      .filter((c) => !c.isThread() && c.type !== 4)
      .map((c) => ({ id: c.id, name: c.name, type: c.type, parent: c.parentId, position: (c as import('discord.js').GuildChannel).rawPosition })),
    roles: guild.roles.cache
      .filter((r) => r.name !== '@everyone')
      .map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.rawPosition })),
  };
}

/** Archive l'instantané courant du serveur en audit, avant toute modification destructive. */
export function archiveServerSnapshot(audit: AuditService, guild: Guild, actorId: string, requestId: string): void {
  audit.record({
    guildId: guild.id,
    source: 'agent',
    action: 'server.snapshot',
    actorId,
    metadata: { requestId, snapshot: captureServerSnapshot(guild) },
  });
}

/**
 * Tool getLastSnapshot : dernier instantané complet du serveur (archivé avant
 * toute action destructive), source de vérité pour un retour arrière demandé.
 */
export function buildLastSnapshotTool(prisma: PrismaService): BotTool {
  return {
    name: 'getLastSnapshot',
    description: 'Récupère le dernier instantané complet du serveur (catégories, salons, rôles) archivé avant une modification destructive : la base exacte pour un retour arrière.',
    category: 'agent',
    paramsSchema: z.object({}),
    requiredModules: [],
    permissions: ['ManageChannels'],
    destructive: false,
    systemPrompt:
      'Pour tout « remets comme avant / rollback » : compare ce snapshot à l\u0027état actuel (getServerStyle ou getChannels) puis restaure (renameChannel, moveChannel, setChannelOverwrite, createRole...). Jamais de « je ne peux pas revenir en arrière ».',
    handler: async (_input, ctx) => {
      if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
      const entry = await prisma.auditLog.findFirst({
        where: { guildId: ctx.guildId, action: 'server.snapshot' },
        orderBy: { id: 'desc' },
      });
      if (!entry) return { ok: false, summary: 'Aucun instantané archivé pour ce serveur.' };
      const meta = JSON.parse(entry.metadata || '{}') as { snapshot?: unknown; requestId?: string };
      const snapshot = meta.snapshot ?? {};
      return {
        ok: true,
        summary: `Dernier instantané archivé (demande ${meta.requestId ?? '?'}) : catégories/salons/rôles restaurables.`,
        data: { snapshot },
      };
    },
  };
}

/** Historique horodaté des dernières actions de l'agent sur ce serveur (audit). */
export async function fetchRecentActions(prisma: PrismaService, guildId: string, take = 12): Promise<string[]> {
  const rows = await prisma.auditLog
    .findMany({
      where: {
        guildId,
        OR: [
          { action: { startsWith: 'assistant.tool.' } },
          { action: { startsWith: 'agent.op.' } },
          { action: { startsWith: 'agent.plan.' } },
          { action: 'config.patch' },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: { action: true, metadata: true, createdAt: true },
    })
    .catch(() => []);
  return rows.map((row) => {
    let summary = '';
    try {
      const meta = JSON.parse(row.metadata ?? '{}') as { summary?: string; detail?: string; title?: string };
      summary = meta.summary ?? meta.detail ?? (meta.title ? `« ${meta.title} »` : '');
    } catch {
      /* metadata vide */
    }
    const time = row.createdAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const short = row.action.replace('assistant.tool.', '').replace('agent.op.', 'op ');
    return `${time} : ${short}${summary ? ` → ${summary.slice(0, 90)}` : ''}`;
  });
}
