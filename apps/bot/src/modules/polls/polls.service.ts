import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
} from 'discord.js';
import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';

/**
 * Sondages à durée : message V2 avec un bouton par option, un vote par
 * membre (modifiable jusqu'à la clôture), clôture AUTOMATIQUE à l'échéance
 * (timer + balayage au boot : survit aux redémarrages) avec édition du
 * message en résultats (compteurs, pourcentages, barres) et boutons retirés.
 * État persisté dans AgentPanel (kind='poll'), message résolu par row.
 */

const MAX_OPTIONS = 6;

const PollDefinitionSchema = z.object({
  question: z.string().min(3).max(300),
  options: z.array(z.object({ label: z.string().min(1).max(80), emoji: z.string().max(16).optional() })).min(2).max(MAX_OPTIONS),
  durationMinutes: z.number().int().min(1).max(1440),
  closeAt: z.string(),
  votes: z.record(z.string(), z.number().int().min(0).max(MAX_OPTIONS - 1)).default({}),
  closed: z.boolean().default(false),
});

type PollDefinition = z.infer<typeof PollDefinitionSchema>;

export const POLL_VOTE_PREFIX = 'poll:vote';

@Injectable()
export class PollsService implements SpraxiumOnBoot {
  private readonly log = new Logger('Polls');
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly client: Client,
  ) {}

  async onBoot(): Promise<void> {
    getToolRegistry().register(this.createPollTool());
    getToolRegistry().register(this.closePollTool());
    // Balayage au boot : les sondages échus sont clos immédiatement, les
    // autres replanifiés (le timer en mémoire ne survit pas au restart).
    try {
      const polls = await this.prisma.agentPanel.findMany({ where: { kind: 'poll' } });
      for (const row of polls) {
        const poll = this.parse(row.definition);
        if (!poll || poll.closed) continue;
        const closeAt = Date.parse(poll.closeAt);
        if (Number.isNaN(closeAt)) continue;
        if (closeAt <= Date.now()) await this.closePoll(row.id).catch(() => {});
        else this.schedule(row.id, closeAt);
      }
    } catch {
      // Table pas encore migrée au tout premier boot.
    }
    this.log.info('Polls ready (tools + auto-close sweep).');
  }

  private parse(definition: string): PollDefinition | null {
    try {
      return PollDefinitionSchema.parse(JSON.parse(definition)) as PollDefinition;
    } catch {
      return null;
    }
  }

  private schedule(panelId: string, closeAt: number): void {
    const existing = this.timers.get(panelId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      void this.closePoll(panelId).catch((error) => this.log.warn(`closePoll: ${(error as Error).message.slice(0, 100)}`));
    }, Math.max(0, closeAt - Date.now()));
    this.timers.set(panelId, timer);
  }

  private createPollTool(): BotTool {
    return {
      name: 'createPoll',
      description:
        'Crée un sondage à durée : un bouton par option (2-6), un vote par membre, clôture AUTOMATIQUE à l\u0029échéance avec résultats (compteurs + pourcentages) édités dans le message.',
      category: 'agent',
      paramsSchema: z.object({
        channelId: z.string().min(1),
        question: z.string().min(3).max(300),
        options: z
          .array(z.object({ label: z.string().min(1).max(80), emoji: z.string().max(16).optional() }))
          .min(2)
          .max(MAX_OPTIONS),
        durationMinutes: z.number().int().min(1).max(1440).default(10).describe('Durée en minutes (1-1440). « dans 10 minutes » → 10'),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'Le sondage se clôt TOUT SEUL à l\u0029échéance et publie les résultats automatiquement : ne promets JAMAIS de fermer à la main, ne programme pas de relance, ne propose pas de bouton de clôture. Une fois posté, réponds en UNE phrase courte (l\u0029utilisateur voit le message) : pas de répétition du contenu ni de l\u0029ID.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const guild = this.client.guilds.cache.get(ctx.guildId);
        if (!guild) return { ok: false, summary: 'Serveur introuvable.' };
        const { channelId, question, options, durationMinutes } = input as {
          channelId: string;
          question: string;
          options: Array<{ label: string; emoji?: string }>;
          durationMinutes?: number;
        };
        if (new Set(options.map((option) => option.label.toLowerCase())).size !== options.length) {
          return { ok: false, summary: 'Options en double : chaque option doit être distincte.' };
        }
        const channel = await this.client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased() || !('send' in channel) || channel.type !== ChannelType.GuildText) {
          return { ok: false, summary: 'Salon cible introuvable ou non textuel.' };
        }
        if (!guild.members.me?.permissions.has(PermissionFlagsBits.SendMessages)) {
          return { ok: false, summary: "Le bot n'a pas la permission SendMessages sur ce serveur." };
        }

        const duration = durationMinutes ?? 10;
        const closeAt = new Date(Date.now() + duration * 60_000);
        const definition: PollDefinition = {
          question,
          options,
          durationMinutes: duration,
          closeAt: closeAt.toISOString(),
          votes: {},
          closed: false,
        };

        const container = new ContainerBuilder().setAccentColor(0xd9_59_26);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 📊 ${question}`));
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `Un vote par personne, modifiable jusqu\u0029à la clôture. ⏱️ Résultats automatiques dans **${duration} min** (<t:${Math.floor(closeAt.getTime() / 1000)}:R>).`,
          ),
        );
        // 5 boutons max par rangée Discord : 6 options → 2 rangées.
        for (let start = 0; start < options.length; start += 5) {
          const row = new ActionRowBuilder<ButtonBuilder>();
          for (const [index, option] of options.slice(start, start + 5).entries()) {
            const builder = new ButtonBuilder()
              .setCustomId(`${POLL_VOTE_PREFIX}:${start + index}`)
              .setLabel(option.label.slice(0, 80))
              .setStyle(ButtonStyle.Primary);
            if (option.emoji) builder.setEmoji(option.emoji);
            row.addComponents(builder);
          }
          container.addActionRowComponents(row);
        }

        const sent = await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container] }).catch(() => null);
        if (!sent) return { ok: false, summary: 'Impossible de poster le sondage (permissions du salon ?).' };

        const rowRow = await this.prisma.agentPanel.create({
          data: {
            guildId: ctx.guildId,
            channelId,
            messageId: sent.id,
            kind: 'poll',
            definition: JSON.stringify(definition),
            createdByUserId: ctx.userId,
          },
        });
        this.schedule(rowRow.id, closeAt.getTime());
        this.audit.record({
          guildId: ctx.guildId,
          source: 'agent',
          action: 'poll.created',
          actorId: ctx.userId,
          metadata: { panelId: rowRow.id, question: question.slice(0, 100), options: options.length, durationMinutes: duration },
        });
        return {
          ok: true,
          summary: `Sondage posté dans <#${channelId}> ; clôture automatique dans ${duration} min avec résultats.`,
          data: { panelId: rowRow.id, closeAt: closeAt.toISOString() },
        };
      },
    };
  }

  private closePollTool(): BotTool {
    return {
      name: 'poll.close',
      description: 'Clôture un sondage avant l\u0029échéance et publie les résultats.',
      category: 'agent',
      paramsSchema: z.object({ messageId: z.string().min(1).describe('ID du message du sondage') }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: true,
      systemPrompt: 'Pour une clôture anticipée demandée explicitement. Sinon la clôture automatique suffit.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { messageId } = input as { messageId: string };
        const row = await this.prisma.agentPanel.findFirst({ where: { messageId, guildId: ctx.guildId, kind: 'poll' } });
        if (!row) return { ok: false, summary: 'Sondage introuvable pour ce message.' };
        const closed = await this.closePoll(row.id);
        return closed
          ? { ok: true, summary: 'Sondage clôturé, résultats publiés dans le message.' }
          : { ok: false, summary: 'Sondage déjà clôturé.' };
      },
    };
  }

  /** Vote d'un membre (modifiable) : renvoie le texte de confirmation éphémère. */
  async vote(messageId: string, optionIndex: number, userId: string): Promise<string> {
    const row = await this.prisma.agentPanel.findFirst({ where: { messageId } });
    if (!row) throw new Error('Sondage introuvable (supprimé ?).');
    const poll = this.parse(row.definition);
    if (!poll) throw new Error('Définition du sondage illisible.');
    if (poll.closed || Date.parse(poll.closeAt) <= Date.now()) return '⌛ Sondage terminé : les votes ne comptent plus.';
    const option = poll.options[optionIndex];
    if (!option) throw new Error('Option introuvable.');
    const previous = poll.votes[userId];
    if (previous === optionIndex) {
      delete poll.votes[userId];
      await this.save(row.id, poll);
      return `Vote retiré (${option.label}).`;
    }
    poll.votes[userId] = optionIndex;
    await this.save(row.id, poll);
    const changed = previous !== undefined ? ` (change de « ${poll.options[previous]?.label} »)` : '';
    return `Vote pris en compte : **${option.emoji ? `${option.emoji} ` : ''}${option.label}**${changed}.`;
  }

  /** Clôture : édite le message en résultats (barres, %), retire les boutons. */
  async closePoll(panelId: string): Promise<boolean> {
    const row = await this.prisma.agentPanel.findUnique({ where: { id: panelId } });
    if (!row || row.kind !== 'poll') return false;
    const poll = this.parse(row.definition);
    if (!poll || poll.closed) return false;

    poll.closed = true;
    poll.closeAt = new Date().toISOString();
    await this.save(panelId, poll);
    if (this.timers.has(panelId)) {
      clearTimeout(this.timers.get(panelId));
      this.timers.delete(panelId);
    }

    const total = Object.keys(poll.votes).length;
    const counts = poll.options.map((_, index) => Object.values(poll.votes).filter((vote) => vote === index).length);
    const winnerIndex = total > 0 ? counts.indexOf(Math.max(...counts)) : -1;
    const lines = poll.options.map((option, index) => {
      const count = counts[index];
      const percent = total > 0 ? Math.round((count / total) * 100) : 0;
      const barLength = 12;
      const filled = total > 0 ? Math.round((percent / 100) * barLength) : 0;
      const bar = '▮'.repeat(filled) + '░'.repeat(barLength - filled);
      const badge = index === winnerIndex ? ' 🏆' : '';
      return `${option.emoji ? `${option.emoji} ` : ''}**${option.label}** — ${count} vote(s), ${percent} %\n${bar}${badge}`;
    });
    const container = new ContainerBuilder().setAccentColor(0x57_f2_87);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 📊 Résultats : ${poll.question}`));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n\n')));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`🏁 Sondage terminé — **${total}** vote(s) au total.`),
    );

    const channel = await this.client.channels.fetch(row.channelId).catch(() => null);
    if (channel?.isTextBased() && 'messages' in channel) {
      const message = await channel.messages.fetch(row.messageId).catch(() => null);
      if (message) await message.edit({ flags: MessageFlags.IsComponentsV2, components: [container] }).catch(() => {});
    }
    this.audit.record({
      guildId: row.guildId,
      source: 'agent',
      action: 'poll.closed',
      actorId: row.createdByUserId,
      metadata: { panelId, total, question: poll.question.slice(0, 100) },
    });
    return true;
  }

  private async save(panelId: string, poll: PollDefinition): Promise<void> {
    await this.prisma.agentPanel.update({ where: { id: panelId }, data: { definition: JSON.stringify(poll) } });
  }
}
