import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Cron } from 'croner';
import { ChannelType, Client, PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';
import { ActionSchema } from '../automations/automations.service';
import { PrismaService } from '../database/prisma.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { runToolAsSystem } from '../../shared/actions/run-tool';
import { renderTemplate, type BotTool } from '@10cordes/shared';

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
 * Moteur de jobs planifiés GÉNÉRIQUES (unifie le pattern "due-date en DB +
 * timer + sweep au boot" dupliqué par polls/sanctions/vérification) :
 * - once à T (ex : rappel, suppression différée)
 * - cron (tz explicite, next-run recalculé par Croner)
 * - interval en minutes (borné : 5 min à 30 jours)
 * Tick 30s + sweep au boot + fenêtre de grâce 5 min (idempotence) :
 * la DB est la source de vérité, un restart ne perd rien.
 * Actions = le même schéma que les automatisations (sendMessage/sendDm/
 * addRole/removeRole) avec le vocabulaire de templates unifié.
 */

const TICK_MS = 30_000;
const GRACE_MS = 5 * 60_000;

@Injectable()
export class JobsService implements SpraxiumOnBoot {
  private readonly log = new Logger('Jobs');
  private tickTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: Client,
  ) {}

  onBoot(): void {
    for (const tool of this.buildTools()) getToolRegistry().register(tool);
    this.log.info(`${this.buildTools().length} tools jobs enregistrés.`);
    this.tickTimer = setInterval(() => void this.tick(), TICK_MS);
    this.tickTimer.unref?.();
    void this.tick();
  }

  /** Un tick : exécute les jobs dus, replanifie les récurrents. */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const due = await this.prisma.scheduledJob.findMany({
        where: {
          enabled: true,
          OR: [
            { kind: 'once', runAt: { lte: now } },
            { kind: 'cron', runAt: { lte: now } },
            { kind: 'interval', runAt: { lte: now } },
          ],
        },
      });
      for (const job of due) {
        // Fenêtre de grâce : un job trop vieux (crash long) ne rattrape pas
        // des dizaines d'exécutions — il saute à l'occurrence suivante.
        if (job.runAt && now.getTime() - job.runAt.getTime() > GRACE_MS) {
          await this.reschedule(job.id, job.kind, job.runAt, job.cron, job.intervalMinutes, job.tz);
          continue;
        }
        await this.executeJob(job.id, job.guildId, job.name, job.actions);
        await this.reschedule(job.id, job.kind, job.runAt, job.cron, job.intervalMinutes, job.tz);
      }
    } catch (error) {
      this.log.warn(`tick échoué : ${(error as Error).message.slice(0, 120)}`);
    } finally {
      this.running = false;
    }
  }

  private async reschedule(
    jobId: string,
    kind: string,
    currentRunAt: Date | null,
    cron: string | null,
    intervalMinutes: number | null,
    tz: string,
  ): Promise<void> {
    if (kind === 'once') {
      await this.prisma.scheduledJob.update({ where: { id: jobId }, data: { enabled: false, lastRunAt: new Date() } });
      return;
    }
    let next: Date | null = null;
    if (kind === 'interval' && intervalMinutes) {
      next = new Date(Date.now() + intervalMinutes * 60_000);
    } else if (kind === 'cron' && cron) {
      try {
        const cronerJob = new Cron(cron, { timezone: tz });
        next = cronerJob.nextRun() ?? null;
        cronerJob.stop();
      } catch {
        next = null;
      }
    }
    if (!next) {
      await this.prisma.scheduledJob.update({ where: { id: jobId }, data: { enabled: false, lastRunAt: new Date() } });
      return;
    }
    await this.prisma.scheduledJob.update({ where: { id: jobId }, data: { runAt: next, lastRunAt: new Date() } });
  }

  /** Exécute les actions d'un job (même sémantique que les automatisations). */
  private async executeJob(jobId: string, guildId: string, name: string, actionsJson: string): Promise<void> {
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
            const me = guild.members.me;
            if (!me || !channel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) throw new Error('bot sans SendMessages');
            await channel.send({ content: renderTemplate(action.content, vars) });
          }
        } else if (action.type === 'sendDm') {
          // Un job n'a pas de destinataire DM naturel (pas de user dans le
          // contexte) : réservé aux automatisations event-driven.
          throw new Error('sendDm non applicable à un job (pas de destinataire) — utilise une automatisation');
        } else if (action.type === 'addRole' || action.type === 'removeRole') {
          // Retiré du schéma de planification : un job n'a pas de membre
          // cible. Les vieux jobs stockés avec ces actions reçoivent une
          // erreur EXPLICITE (plus de no-op silencieux).
          throw new Error(`${action.type} non applicable à un job (pas de membre cible) — utilise une automatisation`);
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

  private buildTools(): BotTool[] {
    return [
      {
        name: 'jobs.schedule',
        description:
          'Planifie un job récurrent ou différé : once (à une date/heure), cron (expression, tz Europe/Paris par défaut) ou interval (minutes). Actions = sendMessage (templates {{server.name}}, {{member.count}}) et runTool (n\u0027importe quel tool à l\u0027échéance). Les actions de rôle (addRole/removeRole) n\u0027existent pas ici : un job n\u0027a pas de membre cible — passe par les automatisations event-driven pour ça.',
        category: 'jobs',
        paramsSchema: z.object({
          name: z.string().min(1).max(60),
          kind: z.enum(['once', 'cron', 'interval']),
          runAtIso: z.string().optional().describe('kind=once : date ISO (ex 2026-11-21T15:00:00Z)'),
          cron: z.string().optional().describe('kind=cron : expression 5 champs (ex "0 9 * * 1")'),
          intervalMinutes: z.number().int().min(5).max(43_200).optional().describe('kind=interval : minutes'),
          actions: z
            .array(
              z.union([
                z.object({ type: z.literal('sendMessage'), channelId: z.string(), content: z.string().min(1).max(1500) }),
                z.object({
                  type: z.literal('runTool'),
                  name: z.string().min(3).max(40),
                  input: z.record(z.string(), z.unknown()).default({}).describe('Paramètres du tool (ex tally.votes : { messageId, close: true })'),
                }),
              ]),
            )
            .min(1)
            .max(5),
        }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt:
          'Pour les rappels et tâches planifiées. Convertis les dates naturelles en ISO (kind=once) ou en cron. Confirme en UNE ligne avec la prochaine exécution.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { name, kind, runAtIso, cron, intervalMinutes, actions } = input as {
            name: string;
            kind: 'once' | 'cron' | 'interval';
            runAtIso?: string;
            cron?: string;
            intervalMinutes?: number;
            actions: Array<{ type: string; channelId?: string; content?: string; roleId?: string }>;
          };
          let runAt: Date | null = null;
          if (kind === 'once') {
            runAt = runAtIso ? new Date(runAtIso) : null;
            if (!runAt || Number.isNaN(runAt.getTime())) return { ok: false, summary: 'runAtIso manquant ou invalide pour kind=once.' };
            if (runAt.getTime() < Date.now()) return { ok: false, summary: 'Cette date est déjà passée.' };
          }
          if (kind === 'cron' && !cron) return { ok: false, summary: 'kind=cron exige une expression cron.' };
          if (kind === 'interval' && !intervalMinutes) return { ok: false, summary: 'kind=interval exige intervalMinutes.' };
          const cleanActions = actions.map((action) => JSON.parse(JSON.stringify(action)));
          await this.prisma.scheduledJob.upsert({
            where: { guildId_name: { guildId: ctx.guildId, name } },
            create: {
              guildId: ctx.guildId,
              name,
              kind,
              runAt: runAt,
              cron: cron ?? null,
              intervalMinutes: kind === 'interval' ? intervalMinutes ?? null : null,
              actions: JSON.stringify(cleanActions),
            },
            update: { kind, runAt, cron: cron ?? null, intervalMinutes: intervalMinutes ?? null, actions: JSON.stringify(cleanActions), enabled: true, lastError: null },
          });
          void this.tick();
          return { ok: true, summary: `Job « ${name} » planifié (${kind}) et actif.` };
        },
      },
      {
        name: 'jobs.list',
        description: 'Liste les jobs planifiés du serveur (actifs et leur prochaine exécution).',
        category: 'jobs',
        paramsSchema: z.object({}),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Read-only. En [PANEL] si liste longue.',
        handler: async (_input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const jobs = await this.prisma.scheduledJob.findMany({ where: { guildId: ctx.guildId } });
          if (jobs.length === 0) return { ok: true, summary: 'Aucun job planifié sur ce serveur.' };
          const lines = jobs.map((job) => {
            const next = job.runAt && job.enabled ? `<t:${Math.floor(job.runAt.getTime() / 1000)}:R>` : '—';
            return `${job.enabled ? '▶️' : '⏸'} ${job.name} (${job.kind}) → next ${next}${job.lastError ? ` · ERREUR: ${job.lastError.slice(0, 40)}` : ''}`;
          });
          return { ok: true, summary: `${jobs.length} job(s) : ${lines.join(' | ')}` };
        },
      },
      {
        name: 'jobs.cancel',
        description: 'Désactive un job planifié (conservé en DB, réactivable avec jobs.schedule au même nom).',
        category: 'jobs',
        paramsSchema: z.object({ name: z.string().min(1).max(60) }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Désactivation réversible.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { name } = input as { name: string };
          const updated = await this.prisma.scheduledJob.updateMany({
            where: { guildId: ctx.guildId, name },
            data: { enabled: false },
          });
          return updated.count > 0
            ? { ok: true, summary: `Job « ${name} » désactivé.` }
            : { ok: false, summary: `Job « ${name} » introuvable.` };
        },
      },
      {
        name: 'jobs.next',
        description: 'Prochaine exécution d\u0029un job planifié.',
        category: 'jobs',
        paramsSchema: z.object({ name: z.string().min(1).max(60) }),
        requiredModules: [],
        permissions: ['ManageGuild'],
        destructive: false,
        systemPrompt: 'Read-only.',
        handler: async (input, ctx) => {
          if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
          const { name } = input as { name: string };
          const job = await this.prisma.scheduledJob.findFirst({ where: { guildId: ctx.guildId, name } });
          if (!job) return { ok: false, summary: `Job « ${name} » introuvable.` };
          if (!job.enabled) return { ok: true, summary: `Job « ${name} » désactivé.` };
          if (!job.runAt) return { ok: true, summary: `Job « ${name} » sans prochaine exécution.` };
          return {
            ok: true,
            summary: `Job « ${name} » : prochaine exécution <t:${Math.floor(job.runAt.getTime() / 1000)}:R>.`,
          };
        },
      },
    ];
  }
}
