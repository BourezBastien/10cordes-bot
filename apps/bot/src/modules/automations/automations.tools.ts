import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../database/prisma.service';
import { CreateSchema } from './automations.schemas';

/** Ce dont les tools d'automatisation ont besoin : persistance, audit et invalidation du cache. */
export interface AutomationsToolsDeps {
  readonly prisma: PrismaService;
  readonly audit: AuditService;
  /** Invalide le cache des automatisations actives du serveur (après création ou suppression). */
  readonly invalidate: (guildId: string) => Promise<void>;
}

/** Tools d'automatisation de l'agent (ordre d'enregistrement : create, list, delete). */
export function buildAutomationTools(deps: AutomationsToolsDeps): BotTool[] {
  const guildOf = (ctx: { guildId: string | null }): string | null => ctx.guildId;

  return [
    {
      name: 'createAutomation',
      description:
        'Crée une automatisation durable : un trigger Discord (message.created / member.joined / member.left / channel.created, avec filtres salon + contenu) et 1 à 5 actions (sendMessage, sendDm, addRole, removeRole). Les actions s\u2019exécutent à chaque match.',
      category: 'agent',
      paramsSchema: CreateSchema,
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'GATE : ManageGuild requis. Utilise-le APRÈS avoir posé tes questions et récapitulé (pattern skills). Variables de template dans les contenus : {{user}}, {{user.name}}, {{server}}, {{count}}. Les permissions du BOT sont vérifiées à l\u2019exécution : si le bot manque de SendMessages/ManageRoles, l\u2019action échouera avec un audit clair.',
      handler: async (input, ctx) => {
        const guildId = guildOf(ctx);
        if (!guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        try {
          const parsed = CreateSchema.parse(input);
          const created = await deps.prisma.agentAutomation.create({
            data: {
              guildId,
              name: parsed.name,
              triggerType: parsed.triggerType,
              triggerFilter: JSON.stringify(parsed.triggerFilter),
              actions: JSON.stringify(parsed.actions),
              createdByUserId: ctx.userId,
            },
          });
          await deps.invalidate(guildId);
          deps.audit.record({
            guildId,
            source: 'agent',
            action: 'automation.created',
            actorId: ctx.userId,
            metadata: { id: created.id, name: parsed.name, trigger: parsed.triggerType, actions: parsed.actions.length },
          });
          return {
            ok: true,
            summary: `Automatisation « ${parsed.name} » créée (${parsed.triggerType}, ${parsed.actions.length} action(s)).`,
            data: { automationId: created.id },
          };
        } catch (error) {
          return { ok: false, summary: error instanceof Error ? error.message.slice(0, 200) : 'Création impossible.' };
        }
      },
    },
    {
      name: 'listAutomations',
      description: 'Liste les automatisations du serveur (nom, trigger, actions, active/inactive).',
      category: 'agent',
      paramsSchema: z.record(z.string(), z.unknown()),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Read-only. À appeler avant une suppression ou modification.',
      handler: async (_input, ctx) => {
        const guildId = guildOf(ctx);
        if (!guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const rows = await deps.prisma.agentAutomation.findMany({
          where: { guildId, enabled: true },
          orderBy: { createdAt: 'asc' },
        });
        const lines = rows.map(
          (row) => `- ${row.name} (${row.triggerType}${row.enabled ? '' : ', inactive'}, id ${row.id.slice(-6)})`,
        );
        return { ok: true, summary: `${rows.length} automatisation(s) : ${lines.join(' | ') || 'aucune'}`, data: { automations: rows } };
      },
    },
    {
      name: 'deleteAutomation',
      description: 'Supprime (définitivement) une automatisation par id.',
      category: 'agent',
      paramsSchema: z.object({ automationId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt: 'Résous l\u2019id via listAutomations d\u2019abord.',
      handler: async (input, ctx) => {
        const guildId = guildOf(ctx);
        if (!guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { automationId } = input as { automationId: string };
        const row = await deps.prisma.agentAutomation.findFirst({ where: { guildId, id: automationId } });
        if (!row) return { ok: false, summary: 'Automatisation introuvable.' };
        await deps.prisma.agentAutomation.delete({ where: { id: row.id } });
        await deps.invalidate(guildId);
        deps.audit.record({
          guildId,
          source: 'agent',
          action: 'automation.deleted',
          actorId: ctx.userId,
          metadata: { name: row.name },
        });
        return { ok: true, summary: `Automatisation « ${row.name} » supprimée.` };
      },
    },
  ];
}
