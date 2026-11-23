import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Tools de sécurité : permission nodes RBAC (override allow/deny par tool
 * pour un rôle ou un membre). Le gate captcha historique a été retiré
 * (remplacé par le moteur générique : l'agent construit une surface de
 * vérification à la demande via les SkillBlueprints).
 */
@Injectable()
export class SecurityService implements SpraxiumOnBoot {
  private readonly log = new Logger('Security');

  constructor(
    private readonly config: GuildConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onBoot(): void {
    for (const tool of this.buildTools()) getToolRegistry().register(tool);
    this.log.info(`${this.buildTools().length} tools sécurité enregistrés.`);
  }

  private buildTools(): BotTool[] {
    return [
      {
        name: 'node.set',
        description:
          'Permission node : autorise (allow) ou interdit (deny) UN tool précis pour un rôle ou un membre, indépendamment des permissions Discord. deny prime sur tout, allow passe outre les permissions Discord.',
        category: 'security',
        paramsSchema: z.object({
          tool: z.string().min(3).max(40).describe('Nom exact du tool (ex: banMember, sendMessage)'),
          targetId: z.string().min(15).describe('ID du rôle (<@&...>) ou du membre (<@...>)'),
          effect: z.enum(['allow', 'deny']),
        }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt:
          'Couche d\u0027override fine : deny = bloque même un admin ; allow = autorise sans permissions Discord. Le nom du tool doit exister (liste via tools.list). Administrator bypassant Discord reste soumis au deny.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { tool, targetId, effect } = input as { tool: string; targetId: string; effect: 'allow' | 'deny' };
          const cleanTarget = targetId.replace(/[<@&>]/gu, '');
          if (!getToolRegistry().get(tool)) {
            return { ok: false, summary: `Tool « ${tool} » inconnu : vérifie le nom exact (liste via la demande de liste de tools).` };
          }
          await this.prisma.toolNode.upsert({
            where: { guildId_targetId_tool: { guildId: ctx.guildId, targetId: cleanTarget, tool } },
            create: { guildId: ctx.guildId, targetId: cleanTarget, tool, effect },
            update: { effect },
          });
          getToolRegistry().invalidateNodes(ctx.guildId);
          return { ok: true, summary: `Node ${effect.toUpperCase()} posé : ${tool} pour ${effect === 'deny' ? 'cible' : 'cible'} \`${cleanTarget}\`.` };
        },
      },
      {
        name: 'node.remove',
        description: 'Retire un permission node (restore le comportement par défaut du tool).',
        category: 'security',
        paramsSchema: z.object({ tool: z.string().min(3).max(40), targetId: z.string().min(15) }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Neutralise un override posé précédemment.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { tool, targetId } = input as { tool: string; targetId: string };
          const cleanTarget = targetId.replace(/[<@&>]/gu, '');
          const removed = await this.prisma.toolNode.deleteMany({
            where: { guildId: ctx.guildId, targetId: cleanTarget, tool },
          });
          getToolRegistry().invalidateNodes(ctx.guildId);
          return removed.count > 0
            ? { ok: true, summary: `Node retiré : ${tool} pour \`${cleanTarget}\` (comportement par défaut restauré).` }
            : { ok: false, summary: 'Aucun node posé pour cette combinaison.' };
        },
      },
      {
        name: 'node.list',
        description: 'Liste les permission nodes du serveur (overrides allow/deny par tool).',
        category: 'security',
        paramsSchema: z.object({ targetId: z.string().min(15).optional() }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Read-only. En [PANEL] si liste longue.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { targetId } = input as { targetId?: string };
          const rows = await this.prisma.toolNode.findMany({
            where: { guildId: ctx.guildId, ...(targetId ? { targetId: targetId.replace(/[<@&>]/gu, '') } : {}) },
          });
          if (rows.length === 0) return { ok: true, summary: 'Aucun permission node posé sur ce serveur.' };
          const lines = rows.map((row) => `${row.effect.toUpperCase()} ${row.tool} → \`${row.targetId}\``);
          return { ok: true, summary: `${rows.length} node(s) : ${lines.join(' | ')}` };
        },
      },
    ];
  }
}

