import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { GuildConfigService } from '../guild-config/guild-config.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Tools de sécurité : configuration du gate de vérification par l'agent
 * (activer/désactiver, salon, rôle vérifié, délai de kick) et permission
 * nodes (override allow/deny par tool pour un rôle ou un membre).
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
          'Couche d\u0029override fine : deny = bloque même un admin ; allow = autorise sans permissions Discord. Le nom du tool doit exister (liste via tools.list). Administrator bypassant Discord reste soumis au deny.',
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
      {
        name: 'security.verify.setup',
        description:
          'Configure le gate de vérification anti-raid : activation, salon du message, rôle vérifié, délai de kick. Désactivé par défaut.',
        category: 'security',
        paramsSchema: z.object({
          enabled: z.boolean().optional(),
          channelId: z.string().optional().describe('Salon du message de vérification (vide = salon système)'),
          roleId: z.string().optional().describe('Rôle attribué après vérification'),
          kickMinutes: z.number().int().min(0).max(120).optional().describe('Kick si non vérifié après N minutes (0 = jamais)'),
        }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt:
          'Pour « mets en place une vérification à l\u0029arrivée » : demande le salon et le rôle vérifié si absents, patch la config, puis confirme en UNE ligne (kick automatique inclus). Ne reposte pas le message toi-même.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { enabled, channelId, roleId, kickMinutes } = input as {
            enabled?: boolean;
            channelId?: string;
            roleId?: string;
            kickMinutes?: number;
          };
          const patch: Record<string, unknown> = { security: {} };
          const securityPatch = patch.security as Record<string, unknown>;
          if (enabled !== undefined) securityPatch.verificationEnabled = enabled;
          if (channelId !== undefined) securityPatch.verificationChannelId = channelId;
          if (roleId !== undefined) securityPatch.verifiedRoleId = roleId;
          if (kickMinutes !== undefined) securityPatch.kickMinutes = kickMinutes;
          await this.config.patch(ctx.guildId, patch);
          const config = await this.config.get(ctx.guildId);
          const line = (label: string, value: string | null): string => `**${label}** : ${value ?? 'non configuré'}`;
          return {
            ok: true,
            summary:
              'Gate de vérification : ' +
              [
                line('activé', config.security.verificationEnabled ? 'OUI' : 'non'),
                line('salon', config.security.verificationChannelId ? `<#${config.security.verificationChannelId}>` : 'salon système'),
                line('rôle vérifié', config.security.verifiedRoleId ? `<@&${config.security.verifiedRoleId}>` : null),
                line('kick', `${config.security.kickMinutes} min`),
              ].join(' · '),
          };
        },
      },
      {
        name: 'security.verify.status',
        description: 'État du gate de vérification (activé, salon, rôle, délai de kick).',
        category: 'security',
        paramsSchema: z.object({}),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Read-only.',
        handler: async (_input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const config = await this.config.get(ctx.guildId);
          return {
            ok: true,
            summary:
              `Gate ${config.security.verificationEnabled ? 'ACTIF' : 'désactivé'} — salon : ` +
              `${config.security.verificationChannelId ? `<#${config.security.verificationChannelId}>` : 'système'} · ` +
              `rôle : ${config.security.verifiedRoleId ? `<@&${config.security.verifiedRoleId}>` : 'aucun'} · ` +
              `kick : ${config.security.kickMinutes} min.`,
          };
        },
      },
    ];
  }
}

