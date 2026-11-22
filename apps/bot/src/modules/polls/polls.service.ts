import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client, ContainerBuilder, TextDisplayBuilder } from 'discord.js';
import { z } from 'zod';
import { registerComponentAction } from '../../shared/actions/registry';
import { PrismaService } from '../database/prisma.service';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import type { BotTool } from '@10cordes/shared';

/**
 * Sondages COMPOSÉS par l'agent (plus aucun tool createPoll) :
 * 1) l'agent poste son panel avec `sendPanel` — chaque bouton porte
 *    l'action { type: 'vote', choice } (un enregistrement par membre,
 *    modifiable) ;
 * 2) il planifie la clôture avec `jobs.schedule` (kind=once, action
 *    runTool → tally.votes) ;
 * 3) tally.votes dépouille et ÉDITE le message : compteurs, pourcentages,
 *    barres, gagnant, boutons retirés.
 * L'état vit dans AgentRecord (collection 'component_votes') : un vote par
 * membre par message, modifiable. Les sondages hérités (definition closeAt)
 * restent clos par le sweep au boot.
 */

@Injectable()
export class PollsService implements SpraxiumOnBoot {
  private readonly log = new Logger('Polls');

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: Client,
  ) {}

  onBoot(): void {
    // Primitives : dépouillement + executor 'vote'. Le tool createPoll a été
    // retiré : le sondage est une COMPOSITION (sendPanel + jobs.once runTool).
    getToolRegistry().register(this.tallyVotesTool());
    registerComponentAction('vote', async (action, ctx) => {
      if (action.type !== 'vote') return 'Action inattendue.';
      const userId = ctx.userId ?? ctx.member?.id ?? '';
      if (!ctx.channelId || !ctx.member) return 'Membre ou salon introuvable.';
      return this.recordVote({ guildId: ctx.guildId, channelId: ctx.channelId, userId, messageId: ctx.messageId }, action.choice);
    });
    // Sweep hérité : les sondages pré-composition (definition closeAt) closent
    // encore automatiquement au boot s'ils ont échus pendant un arrêt.
    void this.sweepLegacyPolls();
    this.log.info('Polls ready (tally.votes + executor vote + sweep hérité).');
  }

  /** Sondages hérités échus au boot : clôture (definition closeAt). */
  private async sweepLegacyPolls(): Promise<void> {
    try {
      const polls = await this.prisma.agentPanel.findMany({ where: { kind: 'poll' } });
      for (const row of polls) {
        let poll: { closed?: boolean; closeAt?: string } | null = null;
        try {
          poll = JSON.parse(row.definition) as { closed?: boolean; closeAt?: string };
        } catch {
          continue;
        }
        if (!poll || poll.closed) continue;
        const closeAt = poll.closeAt ? Date.parse(poll.closeAt) : Number.NaN;
        if (Number.isNaN(closeAt)) continue;
        if (closeAt <= Date.now()) await this.closeLegacyPoll(row.id).catch(() => {});
      }
    } catch {
      // Table pas encore migrée au tout premier boot.
    }
  }

  /** Clôture d'un sondage hérité : publication des résultats enregistrés. */
  private async closeLegacyPoll(panelId: string): Promise<void> {
    const row = await this.prisma.agentPanel.findUnique({ where: { id: panelId } });
    if (!row) return;
    let definition: { title?: string; description?: string } = {};
    try {
      definition = JSON.parse(row.definition) as { title?: string; description?: string };
    } catch {
      /* définition illisible : on publie quand même un message de clôture */
    }
    const container = new ContainerBuilder().setAccentColor(0x57_f2_87);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## 📊 ${definition.title ?? 'Sondage terminé'}`),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('🏁 Ce sondage (ancien format) est terminé. Les votes détaillés ne sont pas disponibles pour ce format.'),
    );
    const channel = await this.client.channels.fetch(row.channelId).catch(() => null);
    if (channel?.isTextBased() && !channel.isDMBased()) {
      await channel.messages.edit(row.messageId, { components: [container] }).catch(() => {});
    }
  }

  private tallyVotesTool(): BotTool {
    return {
      name: 'tally.votes',
      description:
        'Dépouille les clics enregistrés sur un message à boutons vote (collection component_votes) et ÉDITE le message avec les résultats : compteurs, pourcentages, barres, gagnant, boutons retirés. Utilisé par jobs.schedule (runTool) pour la clôture automatique des sondages composés.',
      category: 'records',
      paramsSchema: z.object({
        messageId: z.string().min(1),
        close: z.boolean().default(true).describe('true = clôturer (retire les boutons) ; false = afficher sans clôturer'),
      }),
      requiredModules: [],
      permissions: ['ManageGuild'],
      destructive: false,
      systemPrompt:
        'La clôture automatique des sondages passe par jobs.schedule (runTool tally.votes à l\u0029échéance) : ne promets jamais de clôturer à la main. Une fois dépouillé, réponds en UNE phrase.',
      handler: async (input, ctx) => {
        if (!ctx.guildId) return { ok: false, summary: 'Contexte de serveur requis.' };
        const { messageId, close } = input as { messageId: string; close?: boolean };
        const edited = await this.tallyVotes(messageId, close !== false);
        return edited
          ? { ok: true, summary: 'Dépouillement publié : le message affiche les résultats et n\u0029accepte plus de vote.' }
          : { ok: false, summary: 'Aucun vote enregistré pour ce message (ou déjà dépouillé).' };
      },
    };
  }

  /** Enregistre un clic de vote (un par membre par message, modifiable). */
  private async recordVote(
    ctx: { guildId: string; channelId: string; userId: string; messageId: string },
    choice: string,
  ): Promise<string> {
    // Match EXACT sur la colonne messageId (+ guildId + createdBy) : le
    // `contains` sur data pouvait matcher le vote d'un AUTRE sondage dont
    // le snowflake est une sous-chaîne (longueurs 17-20 chiffres).
    const existing = await this.prisma.agentRecord.findFirst({
      where: {
        guildId: ctx.guildId,
        collection: 'component_votes',
        createdBy: ctx.userId,
        messageId: ctx.messageId,
      },
    });
    if (existing) {
      await this.prisma.agentRecord.update({
        where: { id: existing.id },
        data: { data: JSON.stringify({ version: 1, messageId: ctx.messageId, channelId: ctx.channelId, choice }) },
      });
      return `Vote mis à jour : **${choice}**.`;
    }
    await this.prisma.agentRecord.create({
      data: {
        guildId: ctx.guildId,
        collection: 'component_votes',
        channelId: ctx.channelId,
        messageId: ctx.messageId,
        createdBy: ctx.userId,
        data: JSON.stringify({ version: 1, messageId: ctx.messageId, channelId: ctx.channelId, choice }),
      },
    });
    return `Vote enregistré : **${choice}**.`;
  }

  /**
   * Dépouille les votes d'un message (AgentRecord component_votes) et édite
   * le message avec les résultats. Retourne false si rien à dépouiller.
   */
  async tallyVotes(messageId: string, close: boolean): Promise<boolean> {
    const votes = await this.prisma.agentRecord.findMany({
      where: { collection: 'component_votes', messageId },
    });
    if (votes.length === 0) return false;

    const parsed = votes
      .map((vote) => {
        try {
          return JSON.parse(vote.data) as { messageId?: string; channelId?: string; choice?: string };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is { messageId: string; channelId: string; choice: string } => entry?.choice !== undefined)
      .filter((entry) => entry.messageId === messageId);
    if (parsed.length === 0) return false;

    const total = parsed.length;
    const counts = new Map<string, number>();
    for (const entry of parsed) counts.set(entry.choice, (counts.get(entry.choice) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const winner = ranked[0]?.[0] ?? null;

    const lines = ranked.map(([choice, count]) => {
      const percent = total > 0 ? Math.round((count / total) * 100) : 0;
      const filled = Math.round((percent / 100) * 12);
      const bar = '▮'.repeat(filled) + '░'.repeat(12 - filled);
      return `${choice} — ${count} vote(s), ${percent} %\n${bar}${total > 0 && choice === winner ? ' 🏆' : ''}`;
    });
    const container = new ContainerBuilder().setAccentColor(0x57_f2_87);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## 📊 Résultats du sondage'));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n\n')));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`🏁 Sondage terminé — **${total}** vote(s) au total.`),
    );

    const channel = await this.client.channels.fetch(parsed[0].channelId).catch(() => null);
    if (channel?.isTextBased() && !channel.isDMBased()) {
      await channel.messages.edit(messageId, { components: [container] }).catch(() => {});
    }
    this.log.info(`Dépouillement ${messageId.slice(-6)} : ${total} vote(s).`);
    return true;
  }
}
