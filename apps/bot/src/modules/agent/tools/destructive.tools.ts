import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { getToolRegistry } from '../../tool-registry/tool-registry.service';
import type { DiscordToolContext } from './tool-context';

/**
 * Tools destructifs à exécution directe (plus de plans depuis le 17/11) :
 * suppression de salon ou de rôle, expulsion, bannissement. Les gates du
 * demandeur sont re-vérifiées par op dans AgentService (archive-first pour
 * les suppressions, audit complet).
 */
export function destructiveTools(toolCtx: DiscordToolContext): BotTool[] {
  const { executeDirectOp } = toolCtx;
  return [
    {
      name: 'deleteChannel',
      description: 'Supprime un salon (snapshot archivé avant suppression). Exécution directe : permissions du demandeur vérifiées.',
      category: 'agent',
      paramsSchema: z.object({ channelId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: true,
      systemPrompt:
        'DESTRUCTIVE but EXECUTES DIRECTLY (no confirmation, no plan): permission-gated. The requester needs ManageChannels and the bot needs ManageChannels. archiveChannel is the gentler alternative unless the user explicitly wants deletion. Fail fast with the tool result if a permission is missing (requester OR bot), never invent obstacles.',
      handler: async (input, ctx) => {
        const { channelId } = input as { channelId: string };
        return executeDirectOp(ctx, { type: 'channel.delete', channelId });
      },
    },
    {
      name: 'channel.remove',
      description:
        'Supprime un salon immédiatement ou APRÈS UN DÉLAI (delayMinutes) via le moteur de jobs, survit aux redémarrages. Idéal pour les fermetures de tickets différées et les cleanups planifiés.',
      category: 'agent',
      paramsSchema: z.object({
        channelId: z.string().min(1),
        delayMinutes: z.number().int().min(0).max(10_080).default(0).describe('0 = immédiat ; sinon suppression différée'),
      }),
      requiredModules: [],
      permissions: ['ManageChannels'],
      destructive: true,
      systemPrompt:
        'Pour les suppressions différées (« supprime ce salon dans 10 minutes ») : delayMinutes + jobs.schedule runTool channel.remove à l\u0027échéance. Un snapshot est archivé avant.',
      handler: async (input, ctx) => {
        const { channelId, delayMinutes } = input as { channelId: string; delayMinutes?: number };
        if (!delayMinutes) return executeDirectOp(ctx, { type: 'channel.delete', channelId });
        const scheduled = await getToolRegistry().run(
          'jobs.schedule',
          {
            name: `delete-${channelId}`,
            kind: 'once',
            runAtIso: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
            actions: [{ type: 'runTool', name: 'channel.remove', input: { channelId, delayMinutes: 0 } }],
          },
          ctx,
        );
        return {
          ok: scheduled.ok,
          summary: `Salon <#${channelId}> supprimé automatiquement dans ${delayMinutes} min.`,
        };
      },
    },
    {
      name: 'deleteRole',
      description: 'Supprime un rôle (snapshot stocké). Exécution directe : permissions du demandeur vérifiées.',
      category: 'agent',
      paramsSchema: z.object({ roleId: z.string().min(1) }),
      requiredModules: [],
      permissions: ['ManageRoles'],
      destructive: true,
      systemPrompt:
        'DESTRUCTIVE but EXECUTES DIRECTLY (no confirmation, no plan): permission-gated. Never guess the roleId: use getRoles. Fail fast with the tool result if a permission is missing, never invent obstacles.',
      handler: async (input, ctx) => {
        const { roleId } = input as { roleId: string };
        return executeDirectOp(ctx, { type: 'role.delete', roleId });
      },
    },
    {
      name: 'kickMember',
      description: 'Expulse un membre du serveur (bots inclus). Exécution directe : permissions du demandeur vérifiées.',
      category: 'agent',
      paramsSchema: z.object({
        userId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
      requiredModules: [],
      permissions: ['KickMembers'],
      destructive: true,
      systemPrompt:
        'EXECUTES DIRECTLY (no confirmation, no plan): permission-gated. Requires requester KickMembers and bot KickMembers, hierarchy applies. Temporary alternative: muteMember. Kicking ANOTHER BOT member is a normal Discord action.',
      handler: async (input, ctx) => {
        const { userId, reason } = input as { userId: string; reason?: string };
        return executeDirectOp(ctx, { type: 'member.kick', userId, reason });
      },
    },
    {
      name: 'banMember',
      description: 'Bannit un utilisateur du serveur. Exécution directe : permissions du demandeur vérifiées.',
      category: 'agent',
      paramsSchema: z.object({
        userId: z.string().min(1),
        reason: z.string().max(512).optional(),
      }),
      requiredModules: [],
      permissions: ['BanMembers'],
      destructive: true,
      systemPrompt:
        'EXECUTES DIRECTLY (no confirmation, no plan): permission-gated. A moderation case is created. Requires requester BanMembers and bot BanMembers. Fail fast with the tool result, never invent obstacles.',
      handler: async (input, ctx) => {
        const { userId, reason } = input as { userId: string; reason?: string };
        return executeDirectOp(ctx, { type: 'member.ban', userId, reason });
      },
    },
  ];
}
