import type { Logger } from '@spraxium/logger';
import { ChannelType, type Client } from 'discord.js';
import { z } from 'zod';
import { botPermissionPolicy } from '../../core/security/bot-permission.policy';
import { ActionSchema } from '../automations/automations.schemas';
import type { PrismaService } from '../database/prisma.service';
import { runToolAsSystem } from '../../shared/actions/run-tool';
import { renderTemplate } from '@10cordes/shared';

/**
 * Schéma d'actions propre aux jobs : les 4 actions d'automatisations +
 * runTool (exécute N'IMPORTE QUEL tool du registry à l'échéance — c'est ce
 * qui rend les jobs universels, ex : tally.votes pour clôturer un sondage).
 */
const JobActionSchema = z.discriminatedUnion('type', [
  ...ActionSchema.options,
  z.object({
    type: z.literal('runTool'),
    name: z.string().min(3).max(40),
    input: z.record(z.string(), z.unknown()).default({}),
  }),
]);

/**
 * Exécution des actions d'un job planifié (effets Discord, tools, résultat
 * remonté en DB). Collaborateur non injectable : instancié par JobsService,
 * qui lui fournit Prisma, le client et son logger.
 */
export class JobsExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: Client,
    private readonly log: Logger,
  ) {}

  /** Exécute les actions d'un job (même sémantique que les automatisations). */
  async executeJob(jobId: string, guildId: string, name: string, actionsJson: string): Promise<void> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;
    let actions: Array<z.infer<typeof JobActionSchema>> = [];
    try {
      actions = z.array(JobActionSchema).min(1).max(5).parse(JSON.parse(actionsJson || '[]'));
    } catch {
      await this.prisma.scheduledJob.update({ where: { id: jobId }, data: { lastError: 'actions invalides' } });
      return;
    }
    const memberCount = guild.memberCount;
    const vars = {
      'server.name': guild.name,
      server: guild.name,
      'member.count': String(memberCount),
      count: String(memberCount),
    };
    let lastError: string | null = null;
    for (const action of actions) {
      try {
        if (action.type === 'sendMessage') {
          const channel = await this.client.channels.fetch(action.channelId).catch(() => null);
          if (channel?.type === ChannelType.GuildText) {
            if (!botPermissionPolicy.canAllInChannel(channel, ['SendMessages'])) throw new Error(botPermissionPolicy.refusal('SendMessages', 'channel'));
            await channel.send({ content: renderTemplate(action.content, vars) });
          }
        } else if (action.type === 'sendDm') {
          // Un job n'a pas de destinataire DM naturel (pas de user dans le
          // contexte) : réservé aux automatisations event-driven.
          throw new Error('sendDm non applicable à un job (pas de destinataire) : utilise une automatisation');
        } else if (action.type === 'addRole' || action.type === 'removeRole') {
          // Retiré du schéma de planification : un job n'a pas de membre
          // cible. Les vieux jobs stockés avec ces actions reçoivent une
          // erreur EXPLICITE (plus de no-op silencieux).
          throw new Error(`${action.type} non applicable à un job (pas de membre cible) : utilise une automatisation`);
        } else if (action.type === 'runTool') {
          // Primitive universelle : exécute n'importe quel tool du registry
          // en tant que système (porte unique auditable, voir run-tool.ts).
          const result = await runToolAsSystem(action.name, action.input, {
            guildId,
            botUserId: this.client.user?.id ?? 'jobs',
          });
          if (!result.ok) throw new Error(result.summary);
        }
      } catch (error) {
        lastError = (error as Error).message.slice(0, 160);
      }
    }
    await this.prisma.scheduledJob.update({
      where: { id: jobId },
      data: { lastRunAt: new Date(), ...(lastError ? { lastError } : {}) },
    });
    this.log.info(`Job « ${name} » exécuté${lastError ? ` (erreur partielle : ${lastError})` : ''}`);
  }
}
